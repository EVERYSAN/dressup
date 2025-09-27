import React from 'react';
import { useAppStore } from '../store/useAppStore';

export const MaskOverlay: React.FC = () => {
  const { selectedMask, showMasks } = useAppStore();

  if (!showMasks || !selectedMask || !selectedMask.bounds) return null;

  const { x = 0, y = 0, width = 0, height = 0 } = selectedMask.bounds || {};
  // width/height が 0 以下なら描画しない（安全側）
  if (!(width > 0 && height > 0)) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* marching ants */}
      <div
        className="absolute border-2 border-yellow-400 animate-pulse"
        style={{
          left: x,
          top: y,
          width,
          height,
          borderStyle: 'dashed',
          animationDuration: '1s',
        }}
      />
      {/* overlay */}
      <div
        className="absolute bg-yellow-400/20"
        style={{ left: x, top: y, width, height }}
      />
    </div>
  );
};
