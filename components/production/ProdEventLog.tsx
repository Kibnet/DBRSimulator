'use client';

import type { ProdLogEntry } from './types';
import { formatTime, getSimDay, getSimHour } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollText } from 'lucide-react';

const typeIcons: Record<ProdLogEntry['type'], string> = {
  order: '📋',
  release: '🔧',
  complete: '✅',
  ship: '📦',
  warning: '⚠',
  info: '⚙',
};

const typeColors: Record<ProdLogEntry['type'], string> = {
  order: 'text-primary',
  release: 'text-foreground',
  complete: 'text-[hsl(142_71%_45%)]',
  ship: 'text-primary',
  warning: 'text-destructive',
  info: 'text-muted-foreground',
};

export function ProdEventLog({ log }: { log: ProdLogEntry[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-primary" />
          Журнал событий
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] overflow-y-auto scrollbar-thin space-y-0.5 pr-1">
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Нажмите «Старт» для начала симуляции
            </p>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="flex gap-2 py-1 border-b border-border/50 last:border-0">
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-12 flex-shrink-0 text-right">
                  д{getSimDay(entry.day)} {String(getSimHour(entry.day)).padStart(2, '0')}ч
                </span>
                <span className={`text-[11px] leading-relaxed ${typeColors[entry.type]}`}>
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
