'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { CustomerOrder, Machine, ProdLogEntry, ProdSimState, ProdStats, ProdConfig, FinancialEvent } from './types';
import {
  getBufferPenetration,
  DEFAULT_PROD_CONFIG,
  buildMachinesFromConfig,
  HOURS_PER_DAY,
  formatTime,
} from './types';

/* ── Counters ── */
let _orderId = 0;
let _logId = 0;

/* ── Helpers ── */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Next status after completing an operation */
function nextStatus(current: CustomerOrder['status']): CustomerOrder['status'] {
  switch (current) {
    case 'queued': return 'op1';
    case 'op1': return 'wip1';
    case 'wip1': return 'op2';
    case 'op2': return 'wip2';
    case 'wip2': return 'op3';
    case 'op3': return 'finished';
    default: return current;
  }
}

/** Which operation stage does this status belong to? (0 = none) */
function statusToOp(status: CustomerOrder['status']): number {
  if (status === 'op1') return 1;
  if (status === 'op2') return 2;
  if (status === 'op3') return 3;
  return 0;
}

/** Which WIP status feeds into an operation */
function wipForOp(opId: number): CustomerOrder['status'] | null {
  if (opId === 1) return 'queued';
  if (opId === 2) return 'wip1';
  if (opId === 3) return 'wip2';
  return null;
}

const OP_NAMES: Record<number, string> = { 1: 'Заготовка', 2: 'Обработка', 3: 'Сборка' };

/**
 * Convert machine capacity (units/day) to processing hours for a given quantity.
 * capacity is in units per 24h day.
 */
function processingHours(qty: number, capacityPerDay: number): number {
  return Math.max(1, Math.ceil((qty * HOURS_PER_DAY) / capacityPerDay));
}

/**
 * Processing hours with Gaussian variability (for actual production only).
 * Uses Box-Muller transform for Gaussian random number.
 */
function processingHoursWithVariability(qty: number, capacityPerDay: number, variability: number): number {
  const baseHours = (qty * HOURS_PER_DAY) / capacityPerDay;
  if (variability <= 0) {
    return Math.max(1, Math.ceil(baseHours));
  }
  // Box-Muller transform for Gaussian random
  const u1 = Math.random();
  const u2 = Math.random();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const variance = baseHours * variability * gaussian;
  return Math.max(1, Math.ceil(baseHours + variance));
}

/* ── Initial state ── */
function createInitialState(config: ProdConfig): ProdSimState {
  const machines = buildMachinesFromConfig(config);
  // Initialize drum schedule: each drum machine available from hour 0
  const drumSchedule: Record<string, number> = {};
  machines.filter((m) => m.operationId === 2).forEach((m) => {
    drumSchedule[m.id] = 0;
  });
  return {
    day: 0,
    isRunning: false,
    speed: 100, // 100ms per tick → 10 sim-hours per real second
    orders: [],
    machines,
    log: [],
    stats: { totalOrders: 0, shippedOnTime: 0, shippedLate: 0, totalShipped: 0, totalSpent: 0, totalEarned: 0, totalLateLoss: 0 },
    drumSchedule,
    financialEvents: [],
  };
}

/* ── Hook ── */
export function useProductionSim() {
  const configRef = useRef<ProdConfig>(DEFAULT_PROD_CONFIG);
  const [state, setState] = useState<ProdSimState>(() => createInitialState(DEFAULT_PROD_CONFIG));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(() => {
    setState((prev) => {
      const newHour = prev.day + 1; // 1 tick = 1 hour
      const orders = prev.orders.map((o) => ({ ...o }));
      const machines = prev.machines.map((m) => ({ ...m }));
      const drumSchedule = { ...prev.drumSchedule };
      const newLog: ProdLogEntry[] = [];
      const stats: ProdStats = { ...prev.stats };
      const financialEvents = [...prev.financialEvents];

      const findOrder = (id: string) => orders.find((o) => o.id === id);
      const findMachine = (id: string) => machines.find((m) => m.id === id);

      /* ── Step 1: Generate new customer orders ── */
      const cfg = configRef.current;
      const og = cfg.orderGen;
      // Convert ordersPerDay to ordersPerHour, with optional demand variability
      let ordersPerHour = og.ordersPerDay / HOURS_PER_DAY;
      
      // Apply Gaussian noise to order rate when demandVariability > 0
      if (cfg.demandVariability > 0) {
        const u1 = Math.random();
        const u2 = Math.random();
        const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const effectiveRate = og.ordersPerDay * (1 + cfg.demandVariability * gaussian);
        ordersPerHour = Math.max(0, effectiveRate) / HOURS_PER_DAY;
      }
      
      let newOrderCount = Math.floor(ordersPerHour);
      if (Math.random() < (ordersPerHour - newOrderCount)) newOrderCount++;

      for (let i = 0; i < newOrderCount; i++) {
        const qty = randInt(og.qtyMin, og.qtyMax);

        let bufferHours: number;
        let drumSlotStart = 0;
        let plannedDrumMachineId: string | null = null;
        let releaseDay = 0;

        if (cfg.dynamicDueDates) {
          // Find drum machine with earliest available slot
          const drumMachines = machines.filter((m) => m.operationId === 2);
          let bestMachineId = drumMachines[0]?.id ?? '';
          let bestAvailable = Infinity;
          for (const dm of drumMachines) {
            const avail = Math.max(drumSchedule[dm.id] ?? 0, newHour);
            if (avail < bestAvailable) {
              bestAvailable = avail;
              bestMachineId = dm.id;
            }
          }
          const bestMachine = drumMachines.find((m) => m.id === bestMachineId);
          const machineCapacity = bestMachine?.capacity ?? 1;

          // Assign drum slot (in hours)
          drumSlotStart = Math.max(drumSchedule[bestMachineId] ?? 0, newHour);
          const drumProcHours = processingHours(qty, machineCapacity);
          drumSchedule[bestMachineId] = drumSlotStart + drumProcHours;
          plannedDrumMachineId = bestMachineId;

          // Total capacities for time estimates (sum of all machines for each operation)
          const op1TotalCapacity = machines.filter((m) => m.operationId === 1).reduce((s, m) => s + m.capacity, 0) || 1;
          const op3TotalCapacity = machines.filter((m) => m.operationId === 3).reduce((s, m) => s + m.capacity, 0) || 1;
          const totalOp1Time = Math.ceil((qty * HOURS_PER_DAY) / op1TotalCapacity);
          const avgOp2Time = drumProcHours;
          const totalOp3Time = Math.ceil((qty * HOURS_PER_DAY) / op3TotalCapacity);

          // dueDay = drumSlotStart + (avgOp2Time + totalOp3Time) × 3
          bufferHours = (drumSlotStart - newHour) + (avgOp2Time + totalOp3Time) * 3;

          // releaseDay = drumSlotStart - totalOp1Time × 3
          releaseDay = Math.max(newHour, drumSlotStart - totalOp1Time * 3);
        } else {
          // Config bufferMin/Max are in days → convert to hours
          bufferHours = randInt(og.bufferMin, og.bufferMax) * HOURS_PER_DAY;
        }
        const order: CustomerOrder = {
          id: `co-${++_orderId}`,
          number: `ЗК-${String(_orderId).padStart(3, '0')}`,
          quantity: qty,
          createdDay: newHour,
          dueDay: newHour + bufferHours,
          bufferHours,
          status: 'queued',
          machineId: null,
          processingRemaining: 0,
          processingTotal: 0,
          drumSlotStart,
          plannedDrumMachineId,
          releaseDay,
        };
        orders.push(order);
        stats.totalOrders++;

        // Financial: spent on raw materials
        const rawCost = qty * cfg.unitCostRaw;
        stats.totalSpent += rawCost;
        financialEvents.push({ hour: newHour, spent: rawCost, earned: 0, penalty: 0 });

        const logMsg = cfg.dynamicDueDates
          ? `📋 Новый заказ ${order.number}: ${qty} ед., барабан ${formatTime(drumSlotStart)}, запуск ${formatTime(releaseDay)}, отгрузка ${formatTime(order.dueDay)}`
          : `📋 Новый заказ ${order.number}: ${qty} ед., срок — ${formatTime(order.dueDay)}`;
        newLog.push({
          id: `log-${++_logId}`,
          day: newHour,
          message: logMsg,
          type: 'order',
        });
      }

      /* ── Step 2: Handle machine breakdowns and repairs ── */
      const machineAvailability = cfg.machineAvailability;
      for (const machine of machines) {
        if (machine.isBrokenDown) {
          // Machine is broken — decrement repair time
          machine.breakdownRemainingHours--;
          if (machine.breakdownRemainingHours <= 0) {
            // Repair complete
            machine.isBrokenDown = false;
            machine.breakdownRemainingHours = 0;
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `🔧 ${machine.name} — ремонт завершён`,
              type: 'repair',
            });
          }
        } else if (!machine.currentOrderId) {
          // Machine is idle and not broken — check for random breakdown
          if (Math.random() > machineAvailability) {
            // Breakdown occurs!
            machine.isBrokenDown = true;
            machine.breakdownRemainingHours = Math.ceil(Math.random() * 8); // 1-8 hours
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `⚠️ ${machine.name} — поломка! Ремонт: ${formatTime(machine.breakdownRemainingHours)}`,
              type: 'breakdown',
            });
          }
        }
      }

      /* ── Step 3: Advance processing on machines (1 hour per tick) ── */
      for (const machine of machines) {
        if (!machine.currentOrderId) continue;
        // Skip processing if machine is broken — order is paused, not lost
        if (machine.isBrokenDown) continue;
        const order = findOrder(machine.currentOrderId);
        if (!order) { machine.currentOrderId = null; continue; }

        order.processingRemaining--;

        if (order.processingRemaining <= 0) {
          // Operation complete — move to next stage
          const completedOp = statusToOp(order.status);
          const newStatus = nextStatus(order.status);
          
          // Record drum exit time when leaving Op2
          if (order.status === 'op2' && newStatus === 'wip2') {
            order.drumExitDay = newHour;
          }
          
          order.status = newStatus;
          order.machineId = null;
          machine.currentOrderId = null;

          if (newStatus === 'finished') {
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `✅ ${order.number} — производство завершено → склад ГП`,
              type: 'complete',
            });
          } else {
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `⚙ ${order.number} — ${OP_NAMES[completedOp]} завершена → ${newStatus === 'wip1' ? 'буфер п/ф 1' : newStatus === 'wip2' ? 'буфер п/ф 2' : OP_NAMES[statusToOp(newStatus)]}`,
              type: 'info',
            });
          }
        }
      }

      /* ── Step 4: Assign orders to idle machines (priority by buffer penetration) ── */
      for (const opId of [2, 1, 3]) {
        // Process constraint (Op2) first, then others
        // Skip machines that are broken down or already processing
        const opMachines = machines.filter(
          (m) => m.operationId === opId && m.currentOrderId === null && !m.isBrokenDown
        );
        if (opMachines.length === 0) continue;

        const feedStatus = wipForOp(opId);
        if (!feedStatus) continue;

        // ── Rope: if enabled and dynamic dates, use releaseDay; otherwise use WIP limit ──
        if (opId === 1 && cfg.ropeEnabled) {
          // ── Starvation protection: limit buffer between Op1 and Op2 (drum) ──
          // Check WIP waiting before drum (orders completed Op1, waiting for Op2)
          const wip1Count = orders.filter((o) => o.status === 'wip1').length;
          if (wip1Count >= cfg.ropeWIPLimit) {
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `🛑 Защита от перегрузки барабана: буфер п/ф 1 переполнен (${wip1Count}/${cfg.ropeWIPLimit})`,
              type: 'warning',
            });
            continue; // Skip assigning new orders to Op1 to prevent overfeeding the drum
          }

          if (cfg.dynamicDueDates) {
            // Rope by releaseDay: only release orders whose releaseDay <= current hour
            const waiting = orders
              .filter((o) => o.status === feedStatus && o.releaseDay <= newHour)
              .sort((a, b) => getBufferPenetration(b, newHour) - getBufferPenetration(a, newHour));

            for (const machine of opMachines) {
              const order = waiting.shift();
              if (!order) break;
              const procHours = processingHoursWithVariability(order.quantity, machine.capacity, cfg.processingVariability);
              order.status = 'op1';
              order.machineId = machine.id;
              order.processingRemaining = procHours;
              order.processingTotal = procHours;
              machine.currentOrderId = order.id;
              newLog.push({
                id: `log-${++_logId}`,
                day: newHour,
                message: `🔧 ${order.number} → ${machine.name} (${OP_NAMES[1]}, ${formatTime(procHours)})`,
                type: 'release',
              });
            }
            continue; // skip default assignment for Op1
          } else {
            const wipBeforeDrum = orders.filter(
              (o) => ['queued', 'op1', 'wip1'].includes(o.status)
            ).length;
            if (wipBeforeDrum >= cfg.ropeWIPLimit) {
              continue;
            }
          }
        }

        // Get waiting orders for this operation, sorted by priority (highest penetration first)
        const waiting = orders
          .filter((o) => o.status === feedStatus)
          .sort((a, b) => getBufferPenetration(b, newHour) - getBufferPenetration(a, newHour));

        for (const machine of opMachines) {
          const order = waiting.shift();
          if (!order) break;

          // Calculate processing time in hours (with variability for actual production)
          const procHours = processingHoursWithVariability(order.quantity, machine.capacity, cfg.processingVariability);
          order.status = `op${opId}` as CustomerOrder['status'];
          order.machineId = machine.id;
          order.processingRemaining = procHours;
          order.processingTotal = procHours;
          machine.currentOrderId = order.id;
          
          // Record drum entry time when starting Op2
          if (opId === 2) {
            order.drumEntryDay = newHour;
          }

          newLog.push({
            id: `log-${++_logId}`,
            day: newHour,
            message: `🔧 ${order.number} → ${machine.name} (${OP_NAMES[opId]}, ${formatTime(procHours)})`,
            type: 'release',
          });
        }
      }

      /* ── Step 5: Track idle time for machines (1 hour per tick) ── */
      for (const machine of machines) {
        if (!machine.currentOrderId) {
          machine.idleHours++;
        }
      }

      /* ── Step 6: Ship finished orders that are due ── */
      for (const order of orders) {
        if (order.status !== 'finished') continue;

        // Only ship when due date has arrived (no early shipping)
        if (newHour >= order.dueDay) {
          const wasLate = newHour > order.dueDay;
          order.status = 'shipped';
          stats.totalShipped++;

          // Financial: earned from shipment
          const revenue = order.quantity * cfg.unitPriceSell;
          stats.totalEarned += revenue;
          let lateLoss = 0;
          if (wasLate) {
            // Late penalty: 1% of revenue per hour late
            const hoursLate = newHour - order.dueDay;
            lateLoss = Math.round(revenue * 0.01 * hoursLate);
            stats.totalLateLoss += lateLoss;
            stats.shippedLate++;
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `⚠ ${order.number} — отгружен с ОПОЗДАНИЕМ (${formatTime(newHour - order.dueDay)})`,
              type: 'warning',
            });
          } else {
            stats.shippedOnTime++;
            newLog.push({
              id: `log-${++_logId}`,
              day: newHour,
              message: `📦 ${order.number} — отгружен вовремя`,
              type: 'ship',
            });
          }
          financialEvents.push({ hour: newHour, spent: 0, earned: revenue, penalty: lateLoss });
        }
      }

      // Remove shipped orders older than 5 days (120 hours) to keep list manageable
      const activeOrders = orders.filter(
        (o) => o.status !== 'shipped' || newHour - o.dueDay < 5 * HOURS_PER_DAY
      );

      // Trim financial events older than 30 days (720 hours)
      const trimmedFinancialEvents = financialEvents.filter(
        (e) => newHour - e.hour <= 30 * HOURS_PER_DAY
      );

      return {
        ...prev,
        day: newHour,
        orders: activeOrders,
        machines,
        drumSchedule,
        log: [...newLog, ...prev.log].slice(0, 200),
        stats,
        financialEvents: trimmedFinancialEvents,
      };
    });
  }, []);

  /* ── Interval ── */
  useEffect(() => {
    if (state.isRunning) {
      intervalRef.current = setInterval(tick, state.speed);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.isRunning, state.speed, tick]);

  const toggleRunning = useCallback(() => {
    setState((prev) => ({ ...prev, isRunning: !prev.isRunning }));
  }, []);

  const reset = useCallback((newConfig?: ProdConfig) => {
    _orderId = 0;
    _logId = 0;
    const cfg = newConfig ?? configRef.current;
    configRef.current = cfg;
    setState(createInitialState(cfg));
  }, []);

  /** Apply new config to running simulation without resetting orders/stats */
  const applyConfig = useCallback((newConfig: ProdConfig) => {
    configRef.current = newConfig;
    setState((prev) => {
      const newMachines = buildMachinesFromConfig(newConfig);
      const oldMap = new Map(prev.machines.map((m) => [m.id, m]));

      // Merge: preserve state for existing machines, init new ones
      const mergedMachines = newMachines.map((nm) => {
        const old = oldMap.get(nm.id);
        if (old) {
          return {
            ...nm,
            currentOrderId: old.currentOrderId,
            idleHours: old.idleHours,
            isBrokenDown: old.isBrokenDown,
            breakdownRemainingHours: old.breakdownRemainingHours,
          };
        }
        return nm;
      });

      // Release orders from removed machines back to their queue status
      const removedIds = new Set(
        prev.machines.filter((m) => !newMachines.find((nm) => nm.id === m.id)).map((m) => m.id)
      );
      const orders = prev.orders.map((o) => {
        if (o.machineId && removedIds.has(o.machineId)) {
          const opNum = prev.machines.find((m) => m.id === o.machineId)?.operationId;
          // Send back to the WIP/queue feeding this operation
          let newStatus = o.status;
          if (opNum === 1) newStatus = 'queued';
          else if (opNum === 2) newStatus = 'wip1';
          else if (opNum === 3) newStatus = 'wip2';
          return { ...o, status: newStatus as typeof o.status, machineId: null, processingRemaining: 0, processingTotal: 0 };
        }
        return o;
      });

      // Rebuild drum schedule for new drum machines
      const drumSchedule: Record<string, number> = {};
      mergedMachines.filter((m) => m.operationId === 2).forEach((m) => {
        drumSchedule[m.id] = prev.drumSchedule[m.id] ?? prev.day;
      });

      return { ...prev, machines: mergedMachines, orders, drumSchedule };
    });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, speed }));
  }, []);

  const toggleRope = useCallback(() => {
    configRef.current = {
      ...configRef.current,
      ropeEnabled: !configRef.current.ropeEnabled,
    };
  }, []);

  const toggleDynamicDueDates = useCallback(() => {
    configRef.current = {
      ...configRef.current,
      dynamicDueDates: !configRef.current.dynamicDueDates,
    };
  }, []);

  /** Live-update a machine's capacity without resetting the simulation */
  const updateMachineCapacity = useCallback((machineId: string, newCapacity: number) => {
    // Update running state
    setState((prev) => ({
      ...prev,
      machines: prev.machines.map((m) =>
        m.id === machineId ? { ...m, capacity: newCapacity } : m
      ),
    }));
    // Sync config ref
    const cfg = configRef.current;
    const ops = JSON.parse(JSON.stringify(cfg.operations)) as ProdConfig['operations'];
    // Find which operation and machine index this ID belongs to
    const match = machineId.match(/^op(\d+)-m(\d+)$/);
    if (match) {
      const opIdx = parseInt(match[1]) - 1;
      const mcIdx = parseInt(match[2]) - 1;
      if (ops[opIdx]?.machines[mcIdx]) {
        ops[opIdx].machines[mcIdx].capacity = newCapacity;
        configRef.current = { ...cfg, operations: ops };
      }
    }
  }, []);

  /** Live-update a config value without resetting the simulation */
  const updateConfigValue = useCallback(<K extends keyof ProdConfig>(key: K, value: ProdConfig[K]) => {
    configRef.current = { ...configRef.current, [key]: value };
  }, []);

  /** Live-update an orderGen config value */
  const updateOrderGen = useCallback(<K extends keyof ProdConfig['orderGen']>(key: K, value: ProdConfig['orderGen'][K]) => {
    configRef.current = {
      ...configRef.current,
      orderGen: { ...configRef.current.orderGen, [key]: value },
    };
  }, []);

  return {
    state, toggleRunning, reset, applyConfig, setSpeed, config: configRef.current,
    toggleRope, toggleDynamicDueDates,
    updateMachineCapacity, updateConfigValue, updateOrderGen,
  };
}
