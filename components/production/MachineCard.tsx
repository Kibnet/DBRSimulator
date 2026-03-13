'use client';

import { useState, useRef, useEffect } from 'react';
import type { Machine, CustomerOrder } from './types';
import { getOrderZone, ZONE_COLORS, ZONE_BG, ZONE_BORDER, formatTime } from './types';
import { Cog } from 'lucide-react';

interface MachineCardProps {
  machine: Machine;
  order: CustomerOrder | null;
  currentDay: number;
  onCapacityChange?: (machineId: string, capacity: number) => void;
}

export function MachineCard({ machine, order, currentDay, onCapacityChange }: MachineCardProps) {
  const isIdle = !order;
  const zone = order ? getOrderZone(order, currentDay) : null;
  const progress = order && order.processingTotal > 0
    ? ((order.processingTotal - order.processingRemaining) / order.processingTotal) * 100
    : 0;
  const idlePct = currentDay > 0 ? (machine.idleHours / currentDay) * 100 : 0;
  const busyPct = 100 - idlePct;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(machine.capacity));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitCapacity = () => {
    const v = parseInt(editValue);
    if (!isNaN(v) && v >= 1 && v <= 200 && onCapacityChange) {
      onCapacityChange(machine.id, v);
    }
    setEditing(false);
  };

  return (
    <div
      className={`rounded-lg border p-2.5 transition-all duration-300 ${
        isIdle ? 'border-border bg-secondary/30' : ''
      }`}
      style={
        !isIdle && zone
          ? {
              borderColor: ZONE_BORDER[zone],
              background: ZONE_BG[zone],
            }
          : undefined
      }
    >
      {/* Machine header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Cog
            className={`w-3 h-3 flex-shrink-0 ${
              isIdle ? 'text-muted-foreground' : 'animate-spin'
            }`}
            style={
              !isIdle && zone
                ? { color: ZONE_COLORS[zone], animationDuration: '2s' }
                : undefined
            }
          />
          <span className="text-[11px] font-medium text-foreground">{machine.name}</span>
        </div>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={200}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitCapacity}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCapacity();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-14 h-5 rounded border border-primary/50 bg-background px-1 text-[9px] font-mono text-foreground text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <button
            onClick={() => {
              setEditValue(String(machine.capacity));
              setEditing(true);
            }}
            className="text-[9px] text-muted-foreground font-mono tabular-nums hover:text-primary hover:bg-primary/10 rounded px-1 py-0.5 transition-colors cursor-pointer"
            title="Нажмите для редактирования"
          >
            {machine.capacity} ед/дн
          </button>
        )}
      </div>

      {order ? (
        <div>
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-bold font-mono"
              style={{ color: ZONE_COLORS[zone!] }}
            >
              {order.number}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
              {order.quantity} ед · {formatTime(order.processingRemaining)}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: ZONE_COLORS[zone!],
              }}
            />
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/60 italic">простаивает</p>
      )}

      {/* Idle/busy stats */}
      {currentDay > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${busyPct}%`,
                background: busyPct > 80 ? 'hsl(142 71% 45%)' : busyPct > 50 ? 'hsl(45 93% 47%)' : 'hsl(0 72% 51%)',
              }}
            />
          </div>
          <span className="text-[9px] font-mono text-muted-foreground tabular-nums whitespace-nowrap">
            {Math.round(busyPct)}% · {formatTime(machine.idleHours)}
          </span>
        </div>
      )}
    </div>
  );
}
