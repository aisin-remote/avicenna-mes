import { describe, expect, it } from 'vitest';
import { normalisasiGarisPotong, susunPotonganKanbanDariGaris } from './kanban-crop';

describe('susunPotonganKanbanDariGaris', () => {
  it('membentuk enam bidang dari dua garis tidur dan satu garis berdiri', () => {
    const result = susunPotonganKanbanDariGaris(
      { horizontalLines: [1 / 3, 2 / 3], verticalLines: [0.5] },
      210,
      297,
    );

    expect(result.cells).toHaveLength(6);
    expect(result.cells[0]).toMatchObject({ left: 0, top: 0, width: 105, height: 99 });
    expect(result.cells[5]).toMatchObject({ left: 105, top: 198, width: 105, height: 99 });
  });

  it('mengurutkan dan membuang garis yang terlalu dekat', () => {
    expect(normalisasiGarisPotong([0.7, 0.2, 0.21, 1])).toEqual([0.2, 0.7]);
  });
});
