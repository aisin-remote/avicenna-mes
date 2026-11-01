import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { CustomerPdfPrint } from '@/components/cetak/customer-pdf-print';
import type { DeliveryDocumentFile } from '@avicenna/contracts';

export const dynamic = 'force-dynamic';
export default async function DocumentPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const file = await apiFetch<DeliveryDocumentFile>(`/delivery-documents/${id}`);
  return (
    <CustomerPdfPrint
      id={file.id}
      filename={file.filename}
      autoPrint={(await searchParams).print === '1'}
    />
  );
}
