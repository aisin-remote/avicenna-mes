import { describe, expect, it } from 'vitest';
import {
  cleanPisBarcode,
  extractPisLoadingListNumber,
  findPisLabelItem,
  isPisDandoryDock,
  isPisLabelPartMatch,
  matchPisCustomerKanban,
  parsePisTtiKanban,
  samePisPds,
} from './pis';

const first = {
  lineId: 1,
  documentNumber: 'C365A494520',
  partNumber: 'INT-001',
  customerPartNumber: '5716A714HC',
  remainingQty: 2,
};
const second = { ...first, lineId: 2, documentNumber: 'C365A494521' };

describe('PIS scanner cleaning and session', () => {
  it('cleans scanner control characters and legacy z artifacts', () => {
    expect(cleanPisBarcode('\u0002zC365A494520z\r\n')).toBe('C365A494520');
    expect(cleanPisBarcode('zz5716A714HC\t')).toBe('5716A714HC');
    expect(cleanPisBarcode(' ZPART001 ')).toBe('ZPART001');
  });

  it('recognizes the legacy first eleven-character C loading list', () => {
    expect(extractPisLoadingListNumber('zC365A494520 A\r')).toBe('C365A494520');
    expect(extractPisLoadingListNumber('C365A494520EXTRA')).toBe('C365A494520');
    expect(extractPisLoadingListNumber('C123')).toBeNull();
    expect(extractPisLoadingListNumber('A365A494520')).toBeNull();
    expect(extractPisLoadingListNumber('C365-494520')).toBeNull();
  });

  it('compares PDS without case or whitespace and does not mix absent and present PDS', () => {
    expect(samePisPds(' PDS-01 ', 'pds-01')).toBe(true);
    expect(samePisPds(null, '')).toBe(true);
    expect(samePisPds(null, 'PDS-01')).toBe(false);
    expect(samePisPds('PDS-01', 'PDS-02')).toBe(false);
  });

  it('limits DANDORY to the legacy dock subset', () => {
    expect(isPisDandoryDock(' mmki-spd ')).toBe(true);
    expect(isPisDandoryDock('TTI')).toBe(true);
    expect(isPisDandoryDock('MMKI')).toBe(false);
    expect(isPisDandoryDock('TMMIN SPD-ADM')).toBe(false);
  });
});

describe('PIS customer kanban', () => {
  it('requires both a session loading-list token and customer part token', () => {
    expect(
      matchPisCustomerKanban('C365A494520 5716A714HC 20 SERIAL', [first], ['C365A494520'], 'OEM'),
    ).toMatchObject({ ok: true, item: { lineId: 1 }, unique: null });
    expect(
      matchPisCustomerKanban('C365A494520 INT-001 20 SERIAL', [first], ['C365A494520'], 'OEM'),
    ).toEqual({ ok: false, code: 'PART_NOT_FOUND' });
    expect(
      matchPisCustomerKanban('C365A494521 5716A714HC 20 SERIAL', [first], ['C365A494520'], 'OEM'),
    ).toEqual({ ok: false, code: 'LOADING_LIST_MISMATCH' });
  });

  it('does not accept a partial part or loading-list substring', () => {
    expect(
      matchPisCustomerKanban('C365A494520 5716A714HCX 20 SERIAL', [first], ['C365A494520'], 'OEM'),
    ).toEqual({ ok: false, code: 'PART_NOT_FOUND' });
    expect(
      matchPisCustomerKanban('XC365A494520 5716A714HC 20 SERIAL', [first], ['C365A494520'], 'OEM'),
    ).toEqual({ ok: false, code: 'LOADING_LIST_MISMATCH' });
    expect(
      matchPisCustomerKanban('C365A494520X 5716A714HC 20 SERIAL', [first], ['C365A494520'], 'OEM'),
    ).toEqual({ ok: false, code: 'LOADING_LIST_MISMATCH' });
  });

  it('rejects a label used as a kanban, even for MMKI-SPD', () => {
    expect(matchPisCustomerKanban('5716A714HC-001', [first], ['C365A494520'], 'MMKI-SPD')).toEqual({
      ok: false,
      code: 'LABEL_ONLY',
    });
    expect(matchPisCustomerKanban('', [first], ['C365A494520'], 'OEM')).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
    });
  });

  it('scopes MMKI numeric revision suffix to the selected dock', () => {
    const barcode = 'C365A494520 5716A714HC-001 20 SERIAL';
    expect(matchPisCustomerKanban(barcode, [first], ['C365A494520'], 'MMKI-SPD')).toMatchObject({
      ok: true,
    });
    expect(matchPisCustomerKanban(barcode, [first], ['C365A494520'], 'MMKI')).toEqual({
      ok: false,
      code: 'PART_NOT_FOUND',
    });
  });

  it('allocates the first unfinished item in displayed LL order', () => {
    const barcode = 'C365A494520 5716A714HC 20 SERIAL';
    expect(
      matchPisCustomerKanban(barcode, [first, second], ['C365A494520', 'C365A494521'], 'OEM'),
    ).toMatchObject({ ok: true, item: { lineId: 1 } });
    expect(
      matchPisCustomerKanban(
        barcode,
        [{ ...first, remainingQty: 0 }, second],
        ['C365A494520', 'C365A494521'],
        'OEM',
      ),
    ).toMatchObject({ ok: true, item: { lineId: 2 } });
    expect(
      matchPisCustomerKanban(barcode, [{ ...first, remainingQty: 0 }], ['C365A494520'], 'OEM'),
    ).toEqual({ ok: false, code: 'TARGET_REACHED' });
  });
});

describe('PIS physical label matching', () => {
  it('disambiguates known A1/A14 parts before considering scanner suffix variants', () => {
    const shorter = { ...first, partNumber: 'SHORT', customerPartNumber: '69210VT010A1' };
    const longer = { ...second, partNumber: 'LONG', customerPartNumber: '69210VT010A14' };
    expect(findPisLabelItem('69210VT010A14', [shorter, longer], 'OEM')).toBe(longer);
    expect(findPisLabelItem('69210VT010A140001', [shorter, longer], 'OEM')).toBe(longer);
    expect(
      findPisLabelItem('69210VT010A14', [shorter, { ...longer, remainingQty: 0 }], 'OEM'),
    ).toBeNull();
    expect(findPisLabelItem('69210VT010A1', [shorter, longer], 'OEM')).toBe(shorter);
  });

  it('accepts internal or customer part and uses unfinished item order', () => {
    expect(findPisLabelItem('INT-001', [first], 'OEM')).toBe(first);
    expect(findPisLabelItem('5716A714HC', [first], 'OEM')).toBe(first);
    expect(findPisLabelItem('5716A714HC', [{ ...first, remainingQty: 0 }, second], 'OEM')).toBe(
      second,
    );
    expect(findPisLabelItem('UNKNOWN', [first], 'OEM')).toBeNull();
  });

  it('supports the existing scanner variants without arbitrary contains matching', () => {
    expect(isPisLabelPartMatch('5716A707YD0001', '5716A707YD', 'OEM')).toBe(true);
    expect(isPisLabelPartMatch('15100BZ060', '15100BZ06000', 'OEM')).toBe(true);
    expect(isPisLabelPartMatch('16100B9490001', 'D16100B9490001', 'OEM')).toBe(true);
    expect(isPisLabelPartMatch('692060K020E1H', '692060K020E1', 'OEM')).toBe(true);
    expect(isPisLabelPartMatch('5716A714HC  EXTRA', '5716A714HC', 'OEM')).toBe(true);
    expect(isPisLabelPartMatch('XX5716A714HC', '5716A714HC', 'OEM')).toBe(false);
    expect(isPisLabelPartMatch('5716A714HC-ABC', '5716A714HC', 'OEM')).toBe(false);
    expect(isPisLabelPartMatch('', '', 'OEM')).toBe(false);
  });

  it('accepts MMKI-SPD numeric revisions only in that dock', () => {
    expect(isPisLabelPartMatch('5716A714HC-001', '5716A714HC', 'MMKI-SPD')).toBe(true);
    expect(isPisLabelPartMatch('5716A714HC-001', '5716A714HC', 'MMKI')).toBe(false);
    expect(isPisLabelPartMatch('5716A714HC-ABC', '5716A714HC', 'MMKI-SPD')).toBe(false);
  });
});

describe('PIS TTI no-label kanban', () => {
  const barcode = '<WDT>G9C3TP|18|IDAII|85820-X7A00|85820X7A00|20260602|1';
  const item = { ...first, partNumber: '85820X7A00', customerPartNumber: '85820-X7A00' };

  it('extracts unique from first field and part from fourth, never supplier field', () => {
    expect(parsePisTtiKanban(barcode)).toMatchObject({
      unique: 'G9C3TP',
      partNumber: '85820-X7A00',
      partNumberNoDash: '85820X7A00',
    });
    expect(parsePisTtiKanban(cleanPisBarcode(barcode))).toMatchObject({
      unique: 'G9C3TP',
      partNumber: '85820-X7A00',
    });
    expect(parsePisTtiKanban('G9C3TP|18|IDAII')).toBeNull();
    expect(parsePisTtiKanban('G9C3TP|18|IDAII|')).toBeNull();
  });

  it('matches TTI unique plus customer/internal PN without loading-list text', () => {
    expect(matchPisCustomerKanban(barcode, [item], ['C365A494520'], 'TTI')).toMatchObject({
      ok: true,
      unique: 'G9C3TP',
      item: { lineId: 1 },
    });
    expect(
      matchPisCustomerKanban(
        barcode,
        [{ ...item, customerPartNumber: null }],
        ['C365A494520'],
        'TTI',
      ),
    ).toMatchObject({ ok: true });
    expect(matchPisCustomerKanban(barcode, [first], ['C365A494520'], 'TTI')).toEqual({
      ok: false,
      code: 'PART_NOT_FOUND',
    });
    expect(matchPisCustomerKanban('85820-X7A00', [item], ['C365A494520'], 'TTI')).toEqual({
      ok: false,
      code: 'INVALID_FORMAT',
    });
  });
});
