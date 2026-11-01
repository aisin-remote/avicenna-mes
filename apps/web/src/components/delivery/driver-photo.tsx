'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { MAKS_UKURAN_FOTO } from '@avicenna/contracts';

export function DriverPhoto({
  value,
  onChange,
}: {
  value: string;
  onChange: (photo: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    active = useRef(true);
  const [live, setLive] = useState(false),
    [error, setError] = useState('');
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stop();
    };
  }, []);
  async function open() {
    setError('');
    onChange('');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          'Kamera browser memerlukan HTTPS atau localhost. Gunakan Ambil / pilih foto pada perangkat ini.',
        );
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });
      if (!active.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stop();
      stream.current = media;
      setLive(true);
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
    } catch (e) {
      stop();
      setLive(false);
      setError(e instanceof Error ? e.message : 'Kamera tidak dapat dibuka.');
    }
  }
  function capture() {
    const source = video.current;
    if (!source?.videoWidth) return setError('Kamera belum siap. Coba lagi.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(1280, source.videoWidth);
    canvas.height = Math.round((canvas.width * source.videoHeight) / source.videoWidth);
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
    save(canvas);
    stop();
    setLive(false);
  }
  function save(canvas: HTMLCanvasElement) {
    const result = canvas.toDataURL('image/jpeg', 0.8);
    if (result.length > Math.ceil(MAKS_UKURAN_FOTO / 3) * 4 + 64)
      return setError('Foto masih terlalu besar. Ambil ulang dengan resolusi lebih kecil.');
    onChange(result);
  }
  async function file(file?: File) {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 20 * 1024 * 1024
    )
      return setError(
        'Pilih JPG, PNG, atau WebP maksimal 20 MB. Foto akan diperkecil sebelum disimpan.',
      );
    setError('');
    onChange('');
    stop();
    setLive(false);
    const url = URL.createObjectURL(file),
      image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (!active.current) return;
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      save(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (active.current) setError('Foto tidak dapat dibaca.');
    };
    image.src = url;
  }
  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-black">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-contain ${live ? '' : 'hidden'}`}
        />
        {value ? (
          <img
            src={value}
            alt="Foto driver untuk pickup ini"
            className="h-full w-full object-contain"
          />
        ) : !live ? (
          <div className="grid h-full place-items-center text-white/60">
            <Camera className="size-12" />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {live ? (
          <button
            type="button"
            onClick={capture}
            className="min-h-12 rounded-full bg-accent px-6 font-bold text-white"
          >
            Ambil Foto
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void open()}
            className="min-h-12 rounded-full border border-line px-6 font-semibold"
          >
            {value ? 'Foto Ulang' : 'Aktifkan Kamera'}
          </button>
        )}
        <label className="flex min-h-12 cursor-pointer items-center rounded-full border border-line px-6 font-semibold">
          Ambil / pilih foto
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="sr-only"
            onChange={(e) => {
              void file(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-ng">
          {error}
        </p>
      )}
    </div>
  );
}
