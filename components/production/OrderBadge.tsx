'use client';

import type { CustomerOrder, BufferZone } from './types';
import { getBufferPenetration, getOrderZone, ZONE_COLORS, ZONE_BG, ZONE_BORDER, formatTime, HOURS_PER_DAY } from './types';

interface OrderBadgeProps {
  order: CustomerOrder;
  currentDay: number;
  compact?: boolean;
}

export function OrderBadge({ order, currentDay, compact = false }: OrderBadgeProps) {
  const penetration = getBufferPenetration(order, currentDay);
  const zone = getOrderZone(order, currentDay);
  const hoursLeft = order.dueDay - currentDay;

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border"
        style={{
          background: ZONE_BG[zone],
          borderColor: ZONE_BORDER[zone],
          color: ZONE_COLORS[zone],
        }}
      >
        <span>{order.number}</span>
        <span className="opacity-60">{order.quantity}ед</span>
        <span className="opacity-50">→{formatTime(order.dueDay)}</span>
        {order.releaseDay > 0 && order.status === 'queued' && (
          <span className="opacity-40">🚀{formatTime(order.releaseDay)}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-2.5 transition-all duration-300"
      style={{
        background: ZONE_BG[zone],
        borderColor: ZONE_BORDER[zone],
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-xs font-bold font-mono"
          style={{ color: ZONE_COLORS[zone] }}
        >
          {order.number}
        </span>
        <PenetrationDot zone={zone} penetration={penetration} />
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">
          {order.quantity} ед.
        </span>
        <span className="text-muted-foreground font-mono">
          отгрузка: {formatTime(order.dueDay)}
        </span>
      </div>

      <div className="flex items-center justify-between text-[10px] mt-0.5">
        <span className="text-muted-foreground/70">
          создан: {formatTime(order.createdDay)}
        </span>
        <span
          className="font-mono font-medium"
          style={{ color: hoursLeft < 0 ? ZONE_COLORS.red : 'hsl(var(--muted-foreground))' }}
        >
          {hoursLeft >= 0 ? `осталось ${formatTime(hoursLeft)}` : `просрочен ${formatTime(-hoursLeft)}`}
        </span>
      </div>

      {/* Drum slot & release info */}
      {order.drumSlotStart > 0 && (
        <div className="flex items-center justify-between text-[10px] mt-0.5">
          <span className="text-muted-foreground/70 font-mono">
            барабан: {formatTime(order.drumSlotStart)}
          </span>
          {order.releaseDay > 0 && order.status === 'queued' && (
            <span className="font-mono font-medium" style={{ color: currentDay >= order.releaseDay ? ZONE_COLORS.green : 'hsl(var(--muted-foreground) / 0.5)' }}>
              запуск: {formatTime(order.releaseDay)}
            </span>
          )}
        </div>
      )}

      {/* Processing progress bar (if on a machine) */}
      {order.processingTotal > 0 && order.processingRemaining > 0 && (
        <div className="mt-2">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${((order.processingTotal - order.processingRemaining) / order.processingTotal) * 100}%`,
                background: ZONE_COLORS[zone],
              }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground mt-0.5 block">
            осталось {formatTime(order.processingRemaining)}
          </span>
        </div>
      )}

      {/* Buffer penetration bar */}
      <div className="mt-2">
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, penetration)}%`,
              background: ZONE_COLORS[zone],
            }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground mt-0.5 block">
          буфер {Math.round(penetration)}%
        </span>
      </div>
    </div>
  );
}

function PenetrationDot({ zone, penetration }: { zone: BufferZone; penetration: number }) {
  return (
    <div className="flex items-center gap-1">
      <div
        className={`w-2 h-2 rounded-full ${zone === 'red' || zone === 'black' ? 'animate-pulse' : ''}`}
        style={{ background: ZONE_COLORS[zone] }}
      />
      <span
        className="text-[10px] font-mono font-bold tabular-nums"
        style={{ color: ZONE_COLORS[zone] }}
      >
        {Math.round(penetration)}%
      </span>
    </div>
  );
}
