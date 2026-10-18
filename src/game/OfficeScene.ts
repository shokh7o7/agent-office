import Phaser from 'phaser';
import type { Agent } from '../types';
import type { Store } from '../store/store';
import { MAP_H, MAP_W, TILE, type Furniture } from '../sim/map';
import { hash } from '../sim/random';
import { CHAR_H, CHAR_W, FRAMES, FRAME_COUNT, characterSheet, cushionArt, furnitureArt, iconArt, paintMap, type IconKind } from './pixelArt';

interface AgentView {
  sprite: Phaser.GameObjects.Sprite;
  icon: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  sheet: string;
}

const MAP_PX_W = MAP_W * TILE;
const MAP_PX_H = MAP_H * TILE;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 5;

/** Renders the office. All behaviour lives in the Simulation; this only draws. */
export class OfficeScene extends Phaser.Scene {
  private views = new Map<string, AgentView>();
  private ring!: Phaser.GameObjects.Graphics;
  private nameLabel!: Phaser.GameObjects.Text;
  private screens!: Phaser.GameObjects.Graphics;
  private deskById = new Map<string, Furniture>();
  private drag = { active: false, moved: false, x: 0, y: 0, sx: 0, sy: 0 };
  private pinch: { dist: number; zoom: number } | null = null;
  private hitAgent = false;
  private offFocus: (() => void) | null = null;

  constructor(private store: Store) {
    super('office');
  }

  create() {
    const map = this.store.sim.map;
    this.textures.addCanvas('map', paintMap(map));
    this.add.image(0, 0, 'map').setOrigin(0, 0).setDepth(-10);

    for (const k of ['THINKING', 'WAITING', 'COMPLETED', 'ERROR', 'Z'] as IconKind[]) this.textures.addCanvas(`icon-${k}`, iconArt(k));
    this.textures.addCanvas('cushion', cushionArt());

    // furniture, depth-sorted by the bottom edge of the footprint
    const artCache = new Map<string, number>();
    for (const f of map.furniture) {
      const key = `fur-${f.kind}-${f.w}x${f.h}`;
      let offsetX = artCache.get(key);
      if (offsetX === undefined) {
        const art = furnitureArt(f.kind, f.w, f.h);
        this.textures.addCanvas(key, art.canvas);
        offsetX = art.offsetX;
        artCache.set(key, offsetX);
      }
      const img = this.add.image(f.x * TILE + offsetX, (f.y + f.h) * TILE, key).setOrigin(0, 1);
      img.setDepth(f.onWall ? -5 : (f.y + f.h) * TILE);
      if (f.kind === 'desk') {
        this.deskById.set(f.id, f);
        img.setInteractive({ cursor: 'pointer' });
        const ws = map.workstations.find((w) => w.deskFurnitureId === f.id)!;
        img.on('pointermove', (p: Phaser.Input.Pointer) => {
          if (this.hitAgent) return;
          const owner = this.store.sim.agents.find((a) => a.deskId === ws.id);
          this.store.setHover({ agentId: null, deskLabel: `Desk ${ws.label} · ${owner ? owner.name : 'free'}`, ...this.client(p) });
        });
        img.on('pointerout', () => this.store.setHover({ agentId: null, x: 0, y: 0 }));
        img.on('pointerup', () => {
          if (this.drag.moved || this.hitAgent) return;
          const owner = this.store.sim.agents.find((a) => a.deskId === ws.id);
          if (owner) this.store.selectAgent(owner.id);
          else this.store.toast('info', `Desk ${ws.label} is free. Add an agent to use it.`);
        });
      }
    }
    for (const s of map.restSpots) if (s.kind === 'floor') this.add.image(s.pos.x * TILE, (s.pos.y + 1) * TILE, 'cushion').setOrigin(0, 1).setDepth(s.pos.y * TILE + 1);

    this.screens = this.add.graphics().setDepth(MAP_PX_H + 5);
    this.ring = this.add.graphics();
    this.nameLabel = this.add
      .text(0, 0, '', { fontFamily: '"Pixelify Sans", monospace', fontSize: '8px', color: '#ffffff', backgroundColor: '#2b2230', padding: { x: 3, y: 1 }, resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(MAP_PX_H + 20)
      .setVisible(false);

    this.setupCamera();
    this.setupInput();
    this.offFocus = this.store.onFocus((id) => this.focusOn(id));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.offFocus?.());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.offFocus?.());
  }

  // ---------------------------------------------------------------- camera
  private fitZoom() {
    const { width, height } = this.scale;
    return Math.min(width / (MAP_PX_W + 24), height / (MAP_PX_H + 24));
  }

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBackgroundColor('#a8a196');
    cam.setBounds(-48, -48, MAP_PX_W + 96, MAP_PX_H + 96);
    cam.roundPixels = true;
    const narrow = this.scale.width < 700;
    cam.setZoom(Phaser.Math.Clamp(narrow ? Math.max(this.fitZoom(), 1.6) : this.fitZoom(), MIN_ZOOM, MAX_ZOOM));
    if (narrow) cam.centerOn(11 * TILE, 13 * TILE); // start on the workspace, where the desks are
    else cam.centerOn(MAP_PX_W / 2, MAP_PX_H / 2);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (cam.zoom < this.fitZoom() * 0.98 || this.scale.width >= 700) {
        const z = Phaser.Math.Clamp(Math.max(cam.zoom, this.fitZoom()), MIN_ZOOM, MAX_ZOOM);
        if (Math.abs(z - cam.zoom) > 0.01 && cam.zoom < this.fitZoom()) cam.setZoom(z);
      }
    });
  }

  private zoomAt(newZoom: number, screenX: number, screenY: number) {
    const cam = this.cameras.main;
    const z = Phaser.Math.Clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const before = cam.getWorldPoint(screenX, screenY);
    cam.setZoom(z);
    const after = cam.getWorldPoint(screenX, screenY);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  focusOn(agentId: string) {
    const a = this.store.sim.state.agents[agentId];
    if (!a) return;
    const cam = this.cameras.main;
    const zoom = Math.max(cam.zoom, 2.2);
    if (cam.zoom < 2.2) cam.zoomTo(zoom, 450, 'Sine.easeInOut');
    // keep the agent clear of the inspector panel (bottom-left on desktop, top on mobile)
    const wide = this.scale.width >= 900;
    const dx = wide ? -170 / zoom : 0;
    const dy = wide ? 0 : -this.scale.height * 0.22 / zoom;
    cam.pan(a.pos.x * TILE + 8 + dx, a.pos.y * TILE + dy, 450, 'Sine.easeInOut');
  }

  private client(p: Phaser.Input.Pointer) {
    const ev = p.event as MouseEvent | undefined;
    return { x: ev?.clientX ?? p.x, y: ev?.clientY ?? p.y };
  }

  private setupInput() {
    this.input.addPointer(1);
    const cam = this.cameras.main;
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(cam.zoom * (dy > 0 ? 0.88 : 1.14), p.x, p.y);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        this.pinch = { dist: Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y), zoom: cam.zoom };
        this.drag.active = false;
        return;
      }
      this.drag = { active: true, moved: false, x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.pinch) {
        const p1 = this.input.pointer1;
        const p2 = this.input.pointer2;
        if (p1.isDown && p2.isDown) {
          const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
          this.zoomAt(this.pinch.zoom * (d / this.pinch.dist), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
        return;
      }
      if (!this.drag.active || !p.isDown) return;
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > 5) {
        this.drag.moved = true;
        this.store.setHover({ agentId: null, x: 0, y: 0 });
      }
      if (this.drag.moved) {
        cam.scrollX = this.drag.sx - dx / cam.zoom;
        cam.scrollY = this.drag.sy - dy / cam.zoom;
      }
    });
    this.input.on('pointerup', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.pinch) {
        if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) this.pinch = null;
        this.drag.active = false;
        return;
      }
      if (!this.drag.moved && over.length === 0) this.store.selectAgent(null);
      this.drag.active = false;
      // let object handlers read `moved` first, then reset
      this.time.delayedCall(0, () => {
        this.drag.moved = false;
        this.hitAgent = false;
      });
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const step = 40 / cam.zoom;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') cam.scrollX -= step;
      if (e.key === 'ArrowRight') cam.scrollX += step;
      if (e.key === 'ArrowUp') cam.scrollY -= step;
      if (e.key === 'ArrowDown') cam.scrollY += step;
      if (e.key === '+' || e.key === '=') this.zoomAt(cam.zoom * 1.15, this.scale.width / 2, this.scale.height / 2);
      if (e.key === '-') this.zoomAt(cam.zoom / 1.15, this.scale.width / 2, this.scale.height / 2);
    });
  }

  // ---------------------------------------------------------------- agents
  private sheetKey(a: Agent) {
    const ap = a.appearance;
    const key = `char-${hash(`${ap.skin}${ap.hair}${ap.hairStyle}${ap.shirt}${ap.pants}`)}`;
    if (!this.textures.exists(key)) {
      const tex = this.textures.addCanvas(key, characterSheet(ap))!;
      for (let i = 0; i < FRAME_COUNT; i++) tex.add(i, 0, i * CHAR_W, 0, CHAR_W, CHAR_H);
    }
    return key;
  }

  private createView(a: Agent): AgentView {
    const sheet = this.sheetKey(a);
    const sprite = this.add.sprite(0, 0, sheet, 0).setOrigin(0.5, 1);
    sprite.setInteractive({ cursor: 'pointer', hitArea: new Phaser.Geom.Rectangle(2, 0, 12, 24), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
    sprite.on('pointerdown', () => {
      this.hitAgent = true;
    });
    sprite.on('pointermove', (p: Phaser.Input.Pointer) => this.store.setHover({ agentId: a.id, ...this.client(p) }));
    sprite.on('pointerout', () => this.store.setHover({ agentId: null, x: 0, y: 0 }));
    sprite.on('pointerup', () => {
      if (this.drag.moved) return;
      this.hitAgent = true;
      this.store.selectAgent(a.id);
    });
    const icon = this.add.image(0, 0, 'icon-THINKING').setOrigin(0.5, 1).setVisible(false);
    const bar = this.add.graphics();
    return { sprite, icon, bar, sheet };
  }

  update(time: number) {
    const sim = this.store.sim;
    const agents = sim.agents;
    const seen = new Set<string>();
    const selected = this.store.ui.selectedAgentId;
    this.ring.clear();
    this.screens.clear();
    this.nameLabel.setVisible(false);

    for (const a of agents) {
      seen.add(a.id);
      let v = this.views.get(a.id);
      if (!v) {
        v = this.createView(a);
        this.views.set(a.id, v);
      }
      const sheet = this.sheetKey(a);
      if (sheet !== v.sheet) {
        v.sprite.setTexture(sheet, 0);
        v.sheet = sheet;
      }

      const ws = sim.workstation(a);
      const atDesk = !!ws && !a.path.length && a.pos.x === ws.seat.x && a.pos.y === ws.seat.y;
      const rest = a.restSpotId ? sim.map.restSpots.find((s) => s.id === a.restSpotId) : undefined;
      const atRest = a.state === 'SLEEPING' && rest && a.pos.x === rest.pos.x && a.pos.y === rest.pos.y;
      const moving = a.path.length > 0;
      const phase = (time + (hash(a.id) % 1000)) / 1000;

      let x = a.pos.x * TILE + 8;
      let y = a.pos.y * TILE + 16;
      let frame: number = FRAMES.down[0];
      let flip = false;
      let depth = y;

      if (moving) {
        const cyc = [1, 0, 2, 0][Math.floor(phase * 8) % 4];
        const set = a.facing === 'up' ? FRAMES.up : a.facing === 'down' ? FRAMES.down : FRAMES.side;
        frame = set[cyc];
        flip = a.facing === 'left';
      } else if (atDesk) {
        y += 6;
        depth = ws!.seat.y * TILE + 17; // desk below draws over the lap
        frame = a.state === 'WORKING' ? FRAMES.type[Math.floor(phase * 5) % 2] : FRAMES.sit;
        if (a.state === 'WORKING') {
          // monitor glow so working desks read at a glance
          const desk = this.deskById.get(ws!.deskFurnitureId)!;
          this.screens.fillStyle(0x8fd3ff, 0.35 + 0.15 * Math.sin(phase * 6));
          this.screens.fillRect(desk.x * TILE + 32, desk.y * TILE - 6, 17, 2);
        }
      } else if (atRest && rest) {
        if (rest.kind === 'sofa' && rest.facing === 'up') {
          frame = FRAMES.sitBack;
          y += 4;
          depth = (rest.pos.y + 1) * TILE - 1;
        } else {
          frame = FRAMES.sleepSit;
          y += rest.kind === 'floor' ? 2 : 4;
          depth = (rest.pos.y + 1) * TILE + 2;
        }
      } else {
        const set = a.facing === 'up' ? FRAMES.up : a.facing === 'down' ? FRAMES.down : FRAMES.side;
        frame = set[0];
        flip = a.facing === 'left';
        if (a.state === 'IDLE' && Math.floor(phase * 1.5) % 4 === 0) y -= 1; // breathing
      }

      v.sprite.setPosition(Math.round(x), Math.round(y)).setFrame(frame).setFlipX(flip).setDepth(depth);
      v.sprite.setAlpha(a.enabled ? 1 : 0.45);

      // status icon above the head
      const top = Math.round(y) - CHAR_H + (atDesk || atRest ? 2 : 0);
      let iconKey: string | null = null;
      if (a.state === 'THINKING' || a.state === 'WAITING' || a.state === 'COMPLETED' || a.state === 'ERROR') iconKey = `icon-${a.state}`;
      else if (a.state === 'SLEEPING') iconKey = 'icon-Z';
      if (iconKey) {
        const floatY = a.state === 'SLEEPING' ? -((phase * 6) % 6) : Math.round(Math.sin(phase * 4));
        v.icon
          .setTexture(iconKey)
          .setVisible(true)
          .setPosition(Math.round(x) + (a.state === 'SLEEPING' ? 5 : 0), top - 1 + floatY)
          .setDepth(MAP_PX_H + 10)
          .setAlpha(a.state === 'SLEEPING' ? 1 - ((phase * 6) % 6) / 8 : 1);
      } else v.icon.setVisible(false);

      // progress bar while working
      v.bar.clear();
      const task = sim.activeTask(a);
      if (a.state === 'WORKING' && task) {
        const bx = Math.round(x) - 8;
        const by = top - 4;
        v.bar.setDepth(MAP_PX_H + 10);
        v.bar.fillStyle(0x2b2230, 1).fillRect(bx, by, 16, 4);
        v.bar.fillStyle(0xe8e2d6, 1).fillRect(bx + 1, by + 1, 14, 2);
        v.bar.fillStyle(task.simulated ? 0x4aa3a0 : 0x3d6aa8, 1).fillRect(bx + 1, by + 1, Math.round(14 * task.progress), 2);
      }

      if (a.id === selected) {
        const ry = atDesk ? ws!.seat.y * TILE + 15 : Math.round(y);
        this.ring.setDepth(depth - 0.5);
        this.ring.lineStyle(1, 0xffd34d, 1).strokeEllipse(Math.round(x), ry, 16, 7);
        this.ring.fillStyle(0xffd34d, 0.25).fillEllipse(Math.round(x), ry, 16, 7);
        this.nameLabel
          .setText(a.name)
          .setPosition(Math.round(x), top - (iconKey || a.state === 'WORKING' ? 12 : 2))
          .setVisible(true);
      }
    }

    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.sprite.destroy();
      v.icon.destroy();
      v.bar.destroy();
      this.views.delete(id);
    }
  }
}
