import { expect, it } from 'vitest';
import { summarizeProductionByProcess } from './production-summary';

it('memisahkan pabrik/proses, menghitung line tanpa output, dan tidak memasukkan delivery', () => {
  const lines = [
    { plantCode: 'UNIT', processType: 'CASTING_WIP', qtyHariIni: 12 },
    { plantCode: 'UNIT', processType: 'CASTING_WIP', qtyHariIni: 20 },
    { plantCode: 'UNIT', processType: 'CASTING_WIP', qtyHariIni: 0 },
    { plantCode: 'UNIT', processType: 'CASTING_FG', qtyHariIni: 8 },
    { plantCode: 'BODY', processType: 'CASTING_WIP', qtyHariIni: 4 },
    { plantCode: null, processType: 'INJECTION', qtyHariIni: 0 },
    { plantCode: 'UNIT', processType: 'DELIVERY', qtyHariIni: 50 },
  ];
  expect(summarizeProductionByProcess(lines)).toEqual([
    {
      plantCode: 'UNIT',
      processType: 'CASTING_WIP',
      qtyHariIni: 32,
      totalLines: 3,
      producingLines: 2,
    },
    {
      plantCode: 'UNIT',
      processType: 'CASTING_FG',
      qtyHariIni: 8,
      totalLines: 1,
      producingLines: 1,
    },
    {
      plantCode: 'BODY',
      processType: 'CASTING_WIP',
      qtyHariIni: 4,
      totalLines: 1,
      producingLines: 1,
    },
    { plantCode: null, processType: 'INJECTION', qtyHariIni: 0, totalLines: 1, producingLines: 0 },
  ]);
  expect(summarizeProductionByProcess([])).toEqual([]);
  expect(lines[0]?.qtyHariIni).toBe(12);
});
