'use client';

import { useMemo, useRef, useState } from 'react';
import type { EfisiensiJam } from '@avicenna/contracts';

/**
 * Efisiensi per jam satu shift — satu seri, satu sumbu (persen).
 *
 * Mengikuti panduan dataviz: garis 2px, titik ≥8px bercincin permukaan, grid
 * hairline, label nilai hanya di titik terakhir dan puncak; selebihnya lewat
 * crosshair + tooltip yang menempel ke jam terdekat. Jam tanpa nilai (cycle
 * time kosong / belum berjalan) menjadi celah, bukan nol.
 */
export function GrafikEfisiensiJam({
  data,
  jamSekarang,
}: {
  data: EfisiensiJam[];
  jamSekarang: number | null;
}) {
  const L = 720;
  const T = 260;
  const pad = { kiri: 44, kanan: 24, atas: 24, bawah: 32 };
  const lebar = L - pad.kiri - pad.kanan;
  const tinggi = T - pad.atas - pad.bawah;

  const nilai = data.map((d) => d.efisiensi);
  const maks = Math.max(100, ...nilai.filter((v): v is number => v !== null));
  const atasY = Math.ceil(maks / 20) * 20;
  const ticks = Array.from({ length: atasY / 20 + 1 }, (_, i) => i * 20);

  const x = (i: number) =>
    pad.kiri + (data.length <= 1 ? lebar / 2 : (i / (data.length - 1)) * lebar);
  const y = (v: number) => pad.atas + tinggi - (v / atasY) * tinggi;

  // Ruas garis: putus di jam yang tidak punya nilai.
  const ruas = useMemo(() => {
    const hasil: string[] = [];
    let cur: string[] = [];
    data.forEach((d, i) => {
      if (d.efisiensi === null) {
        if (cur.length) hasil.push(cur.join(' '));
        cur = [];
      } else cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.efisiensi).toFixed(1)}`);
    });
    if (cur.length) hasil.push(cur.join(' '));
    return hasil;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, atasY]);

  const terisi = data.map((d, i) => ({ d, i })).filter(({ d }) => d.efisiensi !== null);
  const terakhir = terisi[terisi.length - 1];
  const puncak = terisi.reduce<(typeof terisi)[number] | undefined>(
    (a, b) => (!a || (b.d.efisiensi ?? 0) > (a.d.efisiensi ?? 0) ? b : a),
    undefined,
  );
  const berlabel = new Set([terakhir?.i, puncak?.i].filter((v): v is number => v !== undefined));

  const [aktif, setAktif] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  function gerak(e: React.PointerEvent<SVGSVGElement>) {
    const r = svg.current?.getBoundingClientRect();
    if (!r || data.length === 0) return;
    const px = ((e.clientX - r.left) / r.width) * L;
    let terdekat = 0;
    for (let i = 1; i < data.length; i++) {
      if (Math.abs(x(i) - px) < Math.abs(x(terdekat) - px)) terdekat = i;
    }
    setAktif(terdekat);
  }

  const a = aktif !== null ? data[aktif] : null;

  return (
    <div className="relative">
      <svg
        ref={svg}
        viewBox={`0 0 ${L} ${T}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label="Efisiensi per jam dalam shift ini"
        onPointerMove={gerak}
        onPointerLeave={() => setAktif(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.kiri}
              x2={L - pad.kanan}
              y1={y(t)}
              y2={y(t)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={pad.kiri - 8}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="fill-ink-muted text-[11px] tabular-nums"
            >
              {t}%
            </text>
          </g>
        ))}

        {jamSekarang !== null ? (
          <rect
            x={x(jamSekarang - 1) - 14}
            y={pad.atas}
            width={28}
            height={tinggi}
            rx={6}
            className="fill-surface"
          />
        ) : null}

        {data.map((d, i) => (
          <text
            key={d.ke}
            x={x(i)}
            y={T - 10}
            textAnchor="middle"
            className="fill-ink-muted text-[11px] tabular-nums"
          >
            {d.label}
          </text>
        ))}

        {a ? (
          <line
            x1={x(aktif!)}
            x2={x(aktif!)}
            y1={pad.atas}
            y2={pad.atas + tinggi}
            className="stroke-line-strong"
            strokeWidth={1}
          />
        ) : null}

        {ruas.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            className="stroke-data-1"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {terisi.map(({ d, i }) => (
          <circle
            key={d.ke}
            cx={x(i)}
            cy={y(d.efisiensi!)}
            r={aktif === i ? 5.5 : 4}
            className="fill-data-1 stroke-card"
            strokeWidth={2}
          />
        ))}

        {terisi
          .filter(({ i }) => berlabel.has(i))
          .map(({ d, i }) => (
            <text
              key={`l-${d.ke}`}
              x={x(i)}
              y={y(d.efisiensi!) - 12}
              textAnchor="middle"
              className="fill-ink text-[12px] font-semibold tabular-nums"
            >
              {d.efisiensi!.toFixed(1)}%
            </text>
          ))}
      </svg>

      {a ? (
        <div
          className="pointer-events-none absolute top-2 rounded-xl border border-line bg-card px-3 py-2 text-[12.5px] shadow-lift"
          style={{
            left: `${(x(aktif!) / L) * 100}%`,
            transform: `translateX(${aktif! > data.length / 2 ? 'calc(-100% - 12px)' : '12px'})`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full bg-data-1" aria-hidden />
            <span className="text-[15px] font-bold tabular-nums">
              {a.efisiensi === null ? '—' : `${a.efisiensi.toFixed(1)}%`}
            </span>
          </div>
          <div className="mt-0.5 text-ink-muted">
            Jam {a.label} · OK {a.ok} · {a.menitBersih} menit kerja
          </div>
        </div>
      ) : null}
    </div>
  );
}
