'use client';

import type { CustomerOrder, Machine } from './types';
import { getOrderZone, ZONE_COLORS, ZONE_BG, ZONE_BORDER, HOURS_PER_DAY, formatTime, getSimDay } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from 'lucide-react';

interface GanttChartProps {
  currentDay: number;
  machines: Machine[];
  orders: CustomerOrder[];
  daysToShow?: number;
}

export function GanttChart({ currentDay, machines, orders, daysToShow = 20 }: GanttChartProps) {
  const drumMachines = machines.filter((m) => m.operationId === 2);
  const hoursToShow = daysToShow * HOURS_PER_DAY;
  const startHour = currentDay;
  const endHour = currentDay + hoursToShow;

  // Day labels: show day numbers at day boundaries
  const startDayNum = getSimDay(currentDay);
  const dayLabels: { dayNum: number; offsetPct: number }[] = [];
  for (let d = 0; d <= daysToShow; d++) {
    const hourOfDayStart = d * HOURS_PER_DAY - (currentDay % HOURS_PER_DAY);
    if (hourOfDayStart >= 0 && hourOfDayStart < hoursToShow) {
      dayLabels.push({
        dayNum: startDayNum + d,
        offsetPct: (hourOfDayStart / hoursToShow) * 100,
      });
    }
  }

  // Build drum schedule: current order + estimated queue
  const drumSchedule = drumMachines.map((machine) => {
    const bars: { order: CustomerOrder; startHour: number; endHour: number }[] = [];
    const currentOrder = machine.currentOrderId
      ? orders.find((o) => o.id === machine.currentOrderId)
      : null;

    if (currentOrder && currentOrder.processingRemaining > 0) {
      bars.push({
        order: currentOrder,
        startHour: currentDay,
        endHour: currentDay + currentOrder.processingRemaining,
      });
    }

    // Estimate next orders from WIP1 queue (sorted by priority)
    const wip1Orders = orders
      .filter((o) => o.status === 'wip1')
      .sort((a, b) => {
        const pA = (currentDay - a.createdDay) / (a.bufferHours || 1);
        const pB = (currentDay - b.createdDay) / (b.bufferHours || 1);
        return pB - pA;
      });

    let nextStart = bars.length > 0 ? bars[bars.length - 1].endHour : currentDay;
    // Distribute wip1 orders round-robin across drum machines roughly
    const machineIdx = drumMachines.indexOf(machine);
    for (let i = machineIdx; i < wip1Orders.length; i += drumMachines.length) {
      const o = wip1Orders[i];
      const dur = Math.max(1, Math.ceil((o.quantity * HOURS_PER_DAY) / machine.capacity));
      if (nextStart >= endHour) break;
      bars.push({ order: o, startHour: nextStart, endHour: nextStart + dur });
      nextStart += dur;
    }

    return { machine, bars };
  });

  // Shipment deadlines: all active non-shipped orders
  const shipments = orders
    .filter((o) => o.status !== 'shipped' && o.dueDay >= startHour && o.dueDay <= endHour)
    .sort((a, b) => a.dueDay - b.dueDay);

  // Group shipments by day
  const shipmentsByDay: Record<number, CustomerOrder[]> = {};
  for (const o of shipments) {
    const dayNum = getSimDay(o.dueDay);
    if (!shipmentsByDay[dayNum]) shipmentsByDay[dayNum] = [];
    shipmentsByDay[dayNum].push(o);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          Расписание барабана и отгрузок
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Day headers */}
            <div className="flex border-b border-border mb-1">
              <div className="w-24 flex-shrink-0" />
              <div className="flex-1 relative h-6">
                {dayLabels.map(({ dayNum, offsetPct }) => (
                  <div
                    key={dayNum}
                    className={`absolute text-center text-[9px] font-mono tabular-nums py-1 ${
                      dayNum === getSimDay(currentDay)
                        ? 'text-primary font-bold'
                        : dayNum % 5 === 0
                        ? 'text-secondary-foreground'
                        : 'text-muted-foreground/50'
                    }`}
                    style={{ left: `${offsetPct}%`, transform: 'translateX(-50%)' }}
                  >
                    д{dayNum}
                  </div>
                ))}
              </div>
            </div>

            {/* Drum machine rows */}
            {drumSchedule.map(({ machine, bars }) => (
              <div key={machine.id} className="flex items-center mb-1 min-h-[28px]">
                <div className="w-24 flex-shrink-0 pr-2">
                  <span className="text-[10px] text-secondary-foreground truncate block">
                    {machine.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {machine.capacity} ед/дн
                  </span>
                </div>
                <div className="flex-1 relative h-6 bg-muted/30 rounded">
                  {/* Today marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary/40 z-10"
                    style={{ left: '0%' }}
                  />
                  {/* Day grid lines */}
                  {dayLabels.map(({ dayNum, offsetPct }) => (
                    <div
                      key={dayNum}
                      className="absolute top-0 bottom-0 w-px bg-border/30"
                      style={{ left: `${offsetPct}%` }}
                    />
                  ))}
                  {bars.map(({ order, startHour: bs, endHour: be }) => {
                    const left = Math.max(0, ((bs - startHour) / hoursToShow) * 100);
                    const width = Math.min(
                      100 - left,
                      ((be - bs) / hoursToShow) * 100
                    );
                    if (width <= 0) return null;
                    const zone = getOrderZone(order, currentDay);
                    return (
                      <div
                        key={order.id}
                        className="absolute top-0.5 bottom-0.5 rounded-sm flex items-center justify-center overflow-hidden border"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: ZONE_BG[zone],
                          borderColor: ZONE_BORDER[zone],
                        }}
                        title={`${order.number}: ${order.quantity} ед., отгрузка ${formatTime(order.dueDay)}`}
                      >
                        <span
                          className="text-[8px] font-mono font-bold truncate px-0.5"
                          style={{ color: ZONE_COLORS[zone] }}
                        >
                          {order.number}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Shipment timeline row */}
            <div className="flex items-center mt-2 pt-2 border-t border-border min-h-[28px]">
              <div className="w-24 flex-shrink-0 pr-2">
                <span className="text-[10px] text-secondary-foreground">Отгрузки</span>
              </div>
              <div className="flex-1 relative h-6">
                {/* Day grid lines */}
                {dayLabels.map(({ dayNum, offsetPct }) => (
                  <div
                    key={dayNum}
                    className="absolute top-0 bottom-0 w-px bg-border/30"
                    style={{ left: `${offsetPct}%` }}
                  />
                ))}
                {Object.entries(shipmentsByDay).map(([dayNumStr, dayShipments]) => {
                  const dayNum = parseInt(dayNumStr);
                  // Position at the center of the day
                  const dayStartHour = (dayNum - 1) * HOURS_PER_DAY;
                  const dayCenterHour = dayStartHour + HOURS_PER_DAY / 2;
                  const left = ((dayCenterHour - startHour) / hoursToShow) * 100;
                  if (left < 0 || left > 100) return null;
                  // Show the highest-priority (most penetrated) zone color
                  const worstZone = dayShipments.reduce((worst, o) => {
                    const z = getOrderZone(o, currentDay);
                    const priority = { green: 0, yellow: 1, red: 2, black: 3 };
                    return priority[z] > priority[worst] ? z : worst;
                  }, 'green' as 'green' | 'yellow' | 'red' | 'black');

                  return (
                    <div
                      key={dayNum}
                      className="absolute top-0 flex flex-col items-center"
                      style={{ left: `${left}%` }}
                      title={dayShipments.map((o) => `${o.number} (${o.quantity} ед.)`).join(', ')}
                    >
                      <div
                        className="w-3 h-3 rotate-45 rounded-sm border"
                        style={{
                          background: ZONE_BG[worstZone],
                          borderColor: ZONE_COLORS[worstZone],
                        }}
                      />
                      <span className="text-[8px] font-mono text-muted-foreground mt-0.5">
                        {dayShipments.length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
