import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { OfficeScene } from './OfficeScene';
import { store } from '../store/store';

/**
 * Mounts the Phaser game exactly once. The game reads the shared store each
 * frame, so React re-renders never restart or re-create the world.
 */
export function OfficeGame() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: '#a8a196',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, width: host.current.clientWidth || 800, height: host.current.clientHeight || 600 },
      input: { mouse: { preventDefaultWheel: true } },
      banner: false,
      scene: [new OfficeScene(store)],
    });
    return () => game.destroy(true);
  }, []);

  return <div ref={host} className="office-canvas" aria-label="Office map. Drag to pan, scroll or pinch to zoom, click a character to inspect it." role="application" tabIndex={0} />;
}
