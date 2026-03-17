/* ── Production DBR Simulator Types ── */

/** Buffer penetration zone — determines order priority & color */
export type BufferZone = 'green' | 'yellow' | 'red' | 'black';

/** A customer order received by Sales */
export interface CustomerOrder {
  id: string;
  /** Display number (e.g. "ЗК-001") */
  number: string;
  quantity: number;
  /** Day the order was created */
  createdDay: number;
  /** Day the order must ship */
  dueDay: number;
  /** Total buffer in hours = dueDay - createdDay */
  bufferHours: number;
  /** Current stage of the order */
  status:
    | 'queued'     // waiting to be released to production
    | 'op1'        // being processed at Operation 1
    | 'wip1'       // waiting between Op1 and Op2
    | 'op2'        // being processed at Operation 2
    | 'wip2'       // waiting between Op2 and Op3
    | 'op3'        // being processed at Operation 3
    | 'finished'   // in finished goods warehouse
    | 'shipped';   // shipped to customer
  /** ID of machine currently processing this order (null if not on a machine) */
  machineId: string | null;
  /** Days of processing remaining on current operation */
  processingRemaining: number;
  /** Total days needed for current operation */
  processingTotal: number;
  /** Planned drum slot start day (0 = not scheduled) */
  drumSlotStart: number;
  /** Planned drum machine ID */
  plannedDrumMachineId: string | null;
  /** Day when order should be released to Op1 (rope) */
  releaseDay: number;
  /** Hour when order enters Op2 (drum) — for segmented buffer tracking */
  drumEntryDay?: number;
  /** Hour when order exits Op2 (drum) — for segmented buffer tracking */
  drumExitDay?: number;
}

/** A machine (equipment unit) in a production operation */
export interface Machine {
  id: string;
  name: string;
  /** Which operation stage: 1, 2, or 3 */
  operationId: number;
  /** Units this machine can produce per day (24h continuous) */
  capacity: number;
  /** Order currently being processed (null if idle) */
  currentOrderId: string | null;
  /** Total hours this machine has been idle */
  idleHours: number;
  /** Whether the machine is currently broken down */
  isBrokenDown: boolean;
  /** Hours remaining until repair is complete */
  breakdownRemainingHours: number;
}

/** Log entry */
export interface ProdLogEntry {
  id: string;
  day: number;
  message: string;
  type: 'order' | 'release' | 'complete' | 'ship' | 'warning' | 'info' | 'breakdown' | 'repair';
}

/** Statistics */
export interface ProdStats {
  totalOrders: number;
  shippedOnTime: number;
  shippedLate: number;
  totalShipped: number;
  /** Financial cumulative */
  totalSpent: number;
  totalEarned: number;
  totalLateLoss: number;
}

/** Financial event for rolling window */
export interface FinancialEvent {
  hour: number;
  spent: number;
  earned: number;   // gross revenue (before penalty)
  penalty: number;  // late penalty amount
}

/** Full simulation state */
export interface ProdSimState {
  /** Current simulation hour (1 tick = 1 hour) */
  day: number;
  isRunning: boolean;
  speed: number;
  orders: CustomerOrder[];
  machines: Machine[];
  log: ProdLogEntry[];
  stats: ProdStats;
  /** Drum machine schedule: machineId → next available day */
  drumSchedule: Record<string, number>;
  /** Financial events for rolling window calculations */
  financialEvents: FinancialEvent[];
}

/* ── Helpers ── */

/** Calculate buffer penetration for an order given the current day */
export function getBufferPenetration(order: CustomerOrder, currentDay: number): number {
  // When dynamic dates are active (releaseDay > 0), measure penetration
  // relative to releaseDay → dueDay window
  if (order.releaseDay > 0) {
    const bufferWindow = order.dueDay - order.releaseDay;
    if (bufferWindow <= 0) return 100;
    const consumed = currentDay - order.releaseDay;
    return Math.min(100, Math.max(0, (consumed / bufferWindow) * 100));
  }
  // Fallback: original calculation from createdDay
  if (order.bufferHours <= 0) return 100;
  const consumed = currentDay - order.createdDay;
  return Math.min(100, Math.max(0, (consumed / order.bufferHours) * 100));
}

/** Segmented buffer penetration breakdown */
export interface SegmentedBufferPenetration {
  /** % of rope buffer consumed: time from release to drum entry */
  rope: number;
  /** % of drum buffer consumed: time at drum (Op2) */
  drum: number;
  /** % of shipping buffer consumed: time from drum exit to current/due */
  shipping: number;
  /** Total buffer penetration (existing calculation) */
  total: number;
}

/**
 * Calculate segmented buffer penetration for diagnosing order delays.
 * Segments the total buffer into rope/drum/shipping to identify bottleneck causes.
 */
export function getSegmentedBufferPenetration(
  order: CustomerOrder,
  currentHour: number
): SegmentedBufferPenetration {
  const total = getBufferPenetration(order, currentHour);
  
  // Calculate total buffer window
  const bufferStart = order.releaseDay > 0 ? order.releaseDay : order.createdDay;
  const totalBuffer = order.dueDay - bufferStart;
  
  if (totalBuffer <= 0) {
    return { rope: 100, drum: 100, shipping: 100, total: 100 };
  }
  
  // Estimate planned time for each segment (proportional split: 33% each as baseline)
  // This can be refined if actual processing estimates are stored
  const plannedRopeTime = totalBuffer / 3;
  const plannedDrumTime = totalBuffer / 3;
  const plannedShippingTime = totalBuffer / 3;
  
  let rope = 0;
  let drum = 0;
  let shipping = 0;
  
  // Calculate rope segment (release → drum entry)
  if (order.drumEntryDay !== undefined) {
    // Order has entered drum — rope segment is complete
    const ropeActual = order.drumEntryDay - bufferStart;
    rope = Math.min(100, Math.max(0, (ropeActual / plannedRopeTime) * 100));
  } else if (currentHour > bufferStart) {
    // Order hasn't reached drum yet — show current consumption
    const ropeActual = currentHour - bufferStart;
    rope = Math.min(100, Math.max(0, (ropeActual / plannedRopeTime) * 100));
  }
  
  // Calculate drum segment (drum entry → drum exit)
  if (order.drumEntryDay !== undefined) {
    if (order.drumExitDay !== undefined) {
      // Order has exited drum — drum segment is complete
      const drumActual = order.drumExitDay - order.drumEntryDay;
      drum = Math.min(100, Math.max(0, (drumActual / plannedDrumTime) * 100));
    } else {
      // Order is still at drum — show current consumption
      const drumActual = currentHour - order.drumEntryDay;
      drum = Math.min(100, Math.max(0, (drumActual / plannedDrumTime) * 100));
    }
  }
  
  // Calculate shipping segment (drum exit → due/current)
  if (order.drumExitDay !== undefined) {
    const shippingActual = currentHour - order.drumExitDay;
    shipping = Math.min(100, Math.max(0, (shippingActual / plannedShippingTime) * 100));
  }
  
  return { rope, drum, shipping, total };
}

/** Get zone from buffer penetration % */
export function getZoneFromPenetration(penetration: number): BufferZone {
  if (penetration >= 100) return 'black';
  if (penetration >= 67) return 'red';
  if (penetration >= 33) return 'yellow';
  return 'green';
}

/** Get zone for an order at current day */
export function getOrderZone(order: CustomerOrder, currentDay: number): BufferZone {
  return getZoneFromPenetration(getBufferPenetration(order, currentDay));
}

/** Sort orders by priority (highest penetration first) */
export function sortByPriority(orders: CustomerOrder[], currentDay: number): CustomerOrder[] {
  return [...orders].sort(
    (a, b) => getBufferPenetration(b, currentDay) - getBufferPenetration(a, currentDay)
  );
}

/** Zone color map */
export const ZONE_COLORS: Record<BufferZone, string> = {
  green: 'hsl(142 71% 45%)',
  yellow: 'hsl(45 93% 47%)',
  red: 'hsl(0 72% 51%)',
  black: 'hsl(0 0% 30%)',
};

/** Format money as ₽ with thousands separators */
export function formatMoney(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)}М₽`;
  }
  if (Math.abs(amount) >= 10_000) {
    return `${(amount / 1_000).toFixed(0)}К₽`;
  }
  return `${amount.toLocaleString('ru-RU')}₽`;
}

export const ZONE_BG: Record<BufferZone, string> = {
  green: 'hsl(142 71% 45% / 0.15)',
  yellow: 'hsl(45 93% 47% / 0.15)',
  red: 'hsl(0 72% 51% / 0.15)',
  black: 'hsl(0 0% 30% / 0.15)',
};

export const ZONE_BORDER: Record<BufferZone, string> = {
  green: 'hsl(142 71% 45% / 0.4)',
  yellow: 'hsl(45 93% 47% / 0.4)',
  red: 'hsl(0 72% 51% / 0.4)',
  black: 'hsl(0 0% 30% / 0.4)',
};

/** Russian zone label */
export function getZoneLabel(zone: BufferZone): string {
  switch (zone) {
    case 'green': return 'зелёный';
    case 'yellow': return 'жёлтый';
    case 'red': return 'красный';
    case 'black': return 'чёрный';
  }
}

/* ── Hourly simulation helpers ── */

export const HOURS_PER_DAY = 24;

/** Format hours into human-readable "Xд Yч" format */
export function formatTime(hours: number): string {
  const h = Math.round(hours);
  if (h < 0) return '0ч';
  if (h < HOURS_PER_DAY) return `${h}ч`;
  const days = Math.floor(h / HOURS_PER_DAY);
  const rem = h % HOURS_PER_DAY;
  if (rem === 0) return `${days}д`;
  return `${days}д ${rem}ч`;
}

/** Get simulation day number (1-based) from total hours */
export function getSimDay(totalHours: number): number {
  return Math.floor(totalHours / HOURS_PER_DAY) + 1;
}

/** Get hour within current day (0-23) */
export function getSimHour(totalHours: number): number {
  return totalHours % HOURS_PER_DAY;
}

/* ── Editable Configuration ── */

export interface MachineConfig {
  name: string;
  capacity: number;
}

export interface OperationConfig {
  name: string;
  machines: MachineConfig[];
}

export interface OrderGenConfig {
  /** Probability of generating an order each day (0-1) */
  ordersPerDay: number;
  /** Min quantity per order */
  qtyMin: number;
  /** Max quantity per order */
  qtyMax: number;
  /** Min buffer days (time to due date) */
  bufferMin: number;
  /** Max buffer days */
  bufferMax: number;
}

export interface ProdConfig {
  operations: [OperationConfig, OperationConfig, OperationConfig];
  orderGen: OrderGenConfig;
  /** Rope: limit WIP before drum */
  ropeEnabled: boolean;
  /** Max orders allowed in queue + op1 + wip1 when rope is on */
  ropeWIPLimit: number;
  /** Dynamic due dates: set shipping date based on current buffer load */
  dynamicDueDates: boolean;
  /** Cost of raw material per unit (₽) */
  unitCostRaw: number;
  /** Selling price per finished unit (₽) */
  unitPriceSell: number;
  /** Processing time variability (0 = none, 0.3 = 30% std dev) */
  processingVariability: number;
  /** Machine availability percentage (0.8 to 1.0, where 1.0 = 100% uptime) */
  machineAvailability: number;
  /** Demand variability (0 = none, 0.5 = 50% std dev applied to order generation rate) */
  demandVariability: number;
}

export const DEFAULT_PROD_CONFIG: ProdConfig = {
  operations: [
    {
      name: 'Заготовка',
      machines: [
        { name: 'Станок 1А', capacity: 12 },
        { name: 'Станок 1Б', capacity: 10 },
        { name: 'Станок 1В', capacity: 8 },
      ],
    },
    {
      name: 'Обработка',
      machines: [
        { name: 'Станок 2А', capacity: 8 },
        { name: 'Станок 2Б', capacity: 6 },
      ],
    },
    {
      name: 'Сборка',
      machines: [
        { name: 'Станок 3А', capacity: 10 },
        { name: 'Станок 3Б', capacity: 8 },
        { name: 'Станок 3В', capacity: 6 },
      ],
    },
  ],
  orderGen: {
    ordersPerDay: 1.2,
    qtyMin: 10,
    qtyMax: 50,
    bufferMin: 12,
    bufferMax: 25,
  },
  ropeEnabled: false,
  ropeWIPLimit: 4,
  dynamicDueDates: false,
  unitCostRaw: 100,
  unitPriceSell: 300,
  processingVariability: 0,
  machineAvailability: 1.0,
  demandVariability: 0,
};

/** Build Machine[] from ProdConfig */
export function buildMachinesFromConfig(config: ProdConfig): Machine[] {
  const machines: Machine[] = [];
  config.operations.forEach((op, opIdx) => {
    const opId = opIdx + 1;
    op.machines.forEach((mc, mcIdx) => {
      machines.push({
        id: `op${opId}-m${mcIdx + 1}`,
        name: mc.name,
        operationId: opId,
        capacity: mc.capacity,
        currentOrderId: null,
        idleHours: 0,
        isBrokenDown: false,
        breakdownRemainingHours: 0,
      });
    });
  });
  return machines;
}

/* ── Production Profiles ── */

export interface ProdProfile {
  id: string;
  name: string;
  description: string;
  config: ProdConfig;
}

export const PROD_PROFILES: ProdProfile[] = [
  {
    id: 'balanced',
    name: 'Сбалансированный',
    description: 'Мощности хватает, заказы выполняются в срок',
    config: DEFAULT_PROD_CONFIG,
  },
  {
    id: 'bottleneck',
    name: 'Узкое горлышко',
    description: 'Обработка — явное ограничение, частые опоздания',
    config: {
      operations: [
        {
          name: 'Заготовка',
          machines: [
            { name: 'Станок 1А', capacity: 15 },
            { name: 'Станок 1Б', capacity: 12 },
            { name: 'Станок 1В', capacity: 10 },
          ],
        },
        {
          name: 'Обработка',
          machines: [
            { name: 'Станок 2А', capacity: 5 },
            { name: 'Станок 2Б', capacity: 4 },
          ],
        },
        {
          name: 'Сборка',
          machines: [
            { name: 'Станок 3А', capacity: 12 },
            { name: 'Станок 3Б', capacity: 10 },
            { name: 'Станок 3В', capacity: 8 },
          ],
        },
      ],
      orderGen: { ordersPerDay: 1.5, qtyMin: 15, qtyMax: 60, bufferMin: 12, bufferMax: 22 },
      ropeEnabled: false,
      ropeWIPLimit: 4,
      dynamicDueDates: false,
      unitCostRaw: 100,
      unitPriceSell: 300,
      processingVariability: 0,
      machineAvailability: 1.0,
      demandVariability: 0,
    },
  },
  {
    id: 'rush',
    name: 'Аврал',
    description: 'Много заказов с короткими сроками — стресс-тест',
    config: {
      operations: DEFAULT_PROD_CONFIG.operations,
      orderGen: { ordersPerDay: 2.0, qtyMin: 20, qtyMax: 60, bufferMin: 8, bufferMax: 16 },
      ropeEnabled: false,
      ropeWIPLimit: 5,
      dynamicDueDates: false,
      unitCostRaw: 100,
      unitPriceSell: 300,
      processingVariability: 0,
      machineAvailability: 1.0,
      demandVariability: 0,
    },
  },
  {
    id: 'rope-on',
    name: 'С канатом',
    description: 'Канат включён — WIP перед барабаном ограничен',
    config: {
      operations: DEFAULT_PROD_CONFIG.operations,
      orderGen: { ordersPerDay: 1.5, qtyMin: 10, qtyMax: 50, bufferMin: 12, bufferMax: 25 },
      ropeEnabled: true,
      ropeWIPLimit: 3,
      dynamicDueDates: false,
      unitCostRaw: 100,
      unitPriceSell: 300,
      processingVariability: 0,
      machineAvailability: 1.0,
      demandVariability: 0,
    },
  },
];
