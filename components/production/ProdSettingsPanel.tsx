'use client';

import { useState } from 'react';
import type { ProdConfig, MachineConfig } from './types';
import { DEFAULT_PROD_CONFIG, PROD_PROFILES } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Settings, RotateCcw, Check, X, Factory, ClipboardList, Zap, Plus, Trash2, Shield, Link2, CalendarClock, Banknote, Activity, Wrench } from 'lucide-react';

interface ProdSettingsPanelProps {
  currentConfig: ProdConfig;
  isRunning: boolean;
  onApply: (config: ProdConfig) => void;
  onClose: () => void;
}

/* ── Labeled numeric input ── */
function NumField({
  label,
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-muted-foreground whitespace-nowrap">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
          className="w-20 h-8 rounded-md border border-input bg-secondary px-2 text-sm font-mono text-foreground text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {unit && (
          <span className="text-[10px] text-muted-foreground w-12">{unit}</span>
        )}
      </div>
    </div>
  );
}

const LETTERS = 'АБВГДЕЖЗИКЛМН';

export function ProdSettingsPanel({ currentConfig, isRunning, onApply, onClose }: ProdSettingsPanelProps) {
  const [config, setConfig] = useState<ProdConfig>(() => JSON.parse(JSON.stringify(currentConfig)));

  const updateOrderGen = (key: keyof ProdConfig['orderGen'], value: number) => {
    setConfig((prev) => ({
      ...prev,
      orderGen: { ...prev.orderGen, [key]: value },
    }));
  };

  const updateMachineCapacity = (opIdx: number, mcIdx: number, capacity: number) => {
    setConfig((prev) => {
      const ops = JSON.parse(JSON.stringify(prev.operations));
      ops[opIdx].machines[mcIdx].capacity = capacity;
      return { ...prev, operations: ops };
    });
  };

  const addMachine = (opIdx: number) => {
    setConfig((prev) => {
      const ops = JSON.parse(JSON.stringify(prev.operations));
      const opId = opIdx + 1;
      const mcCount = ops[opIdx].machines.length;
      const letter = LETTERS[mcCount] || String(mcCount + 1);
      ops[opIdx].machines.push({ name: `Станок ${opId}${letter}`, capacity: 6 });
      return { ...prev, operations: ops };
    });
  };

  const removeMachine = (opIdx: number, mcIdx: number) => {
    setConfig((prev) => {
      const ops = JSON.parse(JSON.stringify(prev.operations));
      if (ops[opIdx].machines.length <= 1) return prev; // keep at least 1
      ops[opIdx].machines.splice(mcIdx, 1);
      return { ...prev, operations: ops };
    });
  };

  const applyProfile = (profile: ProdConfig) => {
    setConfig(JSON.parse(JSON.stringify(profile)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin mx-4 animate-fade-in-up">
        <Card className="border-primary/20">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                Параметры производства
              </CardTitle>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isRunning && (
              <p className="text-[11px] text-destructive mt-1">
                Симуляция будет перезапущена при применении изменений
              </p>
            )}
          </CardHeader>

          <CardContent className="space-y-5">
            {/* ── Profiles ── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded bg-secondary flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                </div>
                <h4 className="text-sm font-medium text-foreground">Профиль запуска</h4>
              </div>
              <div className="grid grid-cols-2 gap-2 pl-8">
                {PROD_PROFILES.map((profile) => {
                  const isActive = JSON.stringify(config) === JSON.stringify(profile.config);
                  return (
                    <button
                      key={profile.id}
                      onClick={() => applyProfile(profile.config)}
                      className={`text-left rounded-lg border px-3 py-2.5 transition-all ${
                        isActive
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-border bg-secondary/50 hover:border-primary/30 hover:bg-secondary'
                      }`}
                    >
                      <span className={`text-xs font-medium block ${isActive ? 'text-primary' : 'text-foreground'}`}>
                        {profile.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground leading-tight block mt-0.5">
                        {profile.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="border-t border-border" />

            {/* ── Order generation ── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded bg-secondary flex items-center justify-center">
                  <ClipboardList className="w-3.5 h-3.5 text-primary" />
                </div>
                <h4 className="text-sm font-medium text-foreground">Генерация заказов</h4>
              </div>
              <div className="space-y-2.5 pl-8">
                <NumField
                  label="Заказов в день"
                  value={config.orderGen.ordersPerDay}
                  onChange={(v) => updateOrderGen('ordersPerDay', v)}
                  min={0.1}
                  max={5}
                  step={0.1}
                  unit="шт"
                />
                <NumField
                  label="Мин. кол-во"
                  value={config.orderGen.qtyMin}
                  onChange={(v) => updateOrderGen('qtyMin', v)}
                  min={1}
                  max={200}
                  unit="ед."
                />
                <NumField
                  label="Макс. кол-во"
                  value={config.orderGen.qtyMax}
                  onChange={(v) => updateOrderGen('qtyMax', v)}
                  min={1}
                  max={200}
                  unit="ед."
                />
                <NumField
                  label="Мин. буфер"
                  value={config.orderGen.bufferMin}
                  onChange={(v) => updateOrderGen('bufferMin', v)}
                  min={3}
                  max={60}
                  unit="дн."
                />
                <NumField
                  label="Макс. буфер"
                  value={config.orderGen.bufferMax}
                  onChange={(v) => updateOrderGen('bufferMax', v)}
                  min={3}
                  max={60}
                  unit="дн."
                />
              </div>
            </section>

            <div className="border-t border-border" />

            {/* ── Financial ── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded bg-secondary flex items-center justify-center">
                  <Banknote className="w-3.5 h-3.5 text-primary" />
                </div>
                <h4 className="text-sm font-medium text-foreground">Стоимость</h4>
              </div>
              <div className="space-y-2.5 pl-8">
                <NumField
                  label="Себестоимость ед."
                  value={config.unitCostRaw}
                  onChange={(v) => setConfig((prev) => ({ ...prev, unitCostRaw: v }))}
                  min={1}
                  max={99999}
                  unit="₽"
                />
                <NumField
                  label="Цена продажи ед."
                  value={config.unitPriceSell}
                  onChange={(v) => setConfig((prev) => ({ ...prev, unitPriceSell: v }))}
                  min={1}
                  max={99999}
                  unit="₽"
                />
              </div>
            </section>

            <div className="border-t border-border" />

            {/* ── Buffer & Rope ── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded bg-secondary flex items-center justify-center">
                  <Shield className="w-3.5 h-3.5 text-primary" />
                </div>
                <h4 className="text-sm font-medium text-foreground">Буфер и канат</h4>
              </div>
              <div className="space-y-2.5 pl-8">
                <NumField
                  label="Лимит WIP (канат)"
                  value={config.ropeWIPLimit}
                  onChange={(v) => setConfig((prev) => ({ ...prev, ropeWIPLimit: v }))}
                  min={1}
                  max={20}
                  unit="заказов"
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                    <Link2 className="w-3 h-3" />
                    Канат по умолч.
                  </label>
                  <button
                    onClick={() => setConfig((prev) => ({ ...prev, ropeEnabled: !prev.ropeEnabled }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      config.ropeEnabled ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-foreground transition-transform ${
                        config.ropeEnabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                    <CalendarClock className="w-3 h-3" />
                    Дин. сроки по умолч.
                  </label>
                  <button
                    onClick={() => setConfig((prev) => ({ ...prev, dynamicDueDates: !prev.dynamicDueDates }))}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      config.dynamicDueDates ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-foreground transition-transform ${
                        config.dynamicDueDates ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                    <Activity className="w-3 h-3" />
                    Вариабельность обр.
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={5}
                      value={Math.round(config.processingVariability * 100)}
                      onChange={(e) => setConfig((prev) => ({ ...prev, processingVariability: parseInt(e.target.value) / 100 }))}
                      className="w-20 h-1.5 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
                      {Math.round(config.processingVariability * 100)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                    <Wrench className="w-3 h-3" />
                    Доступность оборуд.
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={80}
                      max={100}
                      step={1}
                      value={Math.round(config.machineAvailability * 100)}
                      onChange={(e) => setConfig((prev) => ({ ...prev, machineAvailability: parseInt(e.target.value) / 100 }))}
                      className="w-20 h-1.5 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
                      {Math.round(config.machineAvailability * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <div className="border-t border-border" />

            {/* ── Operations & Machines ── */}
            {config.operations.map((op, opIdx) => {
              const totalCap = op.machines.reduce((s, m) => s + m.capacity, 0);
              const isDrum = opIdx === 1;
              return (
                <section key={opIdx}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-6 h-6 rounded flex items-center justify-center ${
                      isDrum ? 'bg-destructive/15' : 'bg-secondary'
                    }`}>
                      <Factory className={`w-3.5 h-3.5 ${isDrum ? 'text-destructive' : 'text-primary'}`} />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        Оп. {opIdx + 1}: {op.name}
                        {isDrum && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">
                            Барабан
                          </span>
                        )}
                      </h4>
                      <p className="text-[10px] text-muted-foreground">
                        {op.machines.length} станков · Σ {totalCap} ед/дн
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pl-8">
                    {op.machines.map((mc, mcIdx) => (
                      <div key={mcIdx} className="flex items-center gap-2">
                        <span className="text-xs text-secondary-foreground w-24 truncate">
                          {mc.name}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={mc.capacity}
                          onChange={(e) => {
                            const v = parseInt(e.target.value);
                            if (!isNaN(v) && v >= 1 && v <= 100) updateMachineCapacity(opIdx, mcIdx, v);
                          }}
                          className="w-16 h-7 rounded-md border border-input bg-secondary px-2 text-xs font-mono text-foreground text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-[10px] text-muted-foreground">ед/дн</span>
                        {op.machines.length > 1 && (
                          <button
                            onClick={() => removeMachine(opIdx, mcIdx)}
                            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {op.machines.length < 5 && (
                      <button
                        onClick={() => addMachine(opIdx)}
                        className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Добавить станок
                      </button>
                    )}
                  </div>

                  {opIdx < 2 && <div className="border-t border-border mt-5" />}
                </section>
              );
            })}

            {/* ── Actions ── */}
            <div className="flex items-center gap-3 pt-3 border-t border-border">
              <Button onClick={() => onApply(config)} className="flex-1">
                <Check className="w-4 h-4 mr-2" />
                Применить
              </Button>
              <Button onClick={() => applyProfile(DEFAULT_PROD_CONFIG)} variant="outline">
                <RotateCcw className="w-4 h-4 mr-2" />
                По умолчанию
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
