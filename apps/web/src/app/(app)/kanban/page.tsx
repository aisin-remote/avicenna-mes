import { Scissors } from 'lucide-react';
import { listKanbanCropProfiles } from '@/lib/kanban-crop-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { KanbanCropManager } from '@/components/delivery/kanban-crop-manager';
import { CustomerDocumentUpload } from '@/components/delivery/customer-document-upload';
import { getLoading } from '@/lib/loading-api';
import { DELIVERY_DOCUMENT_KINDS } from '@avicenna/contracts';

export const dynamic = 'force-dynamic';

export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ deliveryId?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const profiles = await listKanbanCropProfiles();
  const doc =
    sp.deliveryId && /^[1-9]\d*$/.test(sp.deliveryId)
      ? await getLoading(Number(sp.deliveryId))
      : null;
  const target = doc
    ? {
        id: doc.id,
        documentNumber: doc.documentNumber,
        pdsNumber: doc.pdsNumber,
        deliveryDate: doc.deliveryDate,
        customerId: doc.customerId,
        customerName: doc.customerName,
      }
    : null;
  const kind = DELIVERY_DOCUMENT_KINDS.find((k) => k === sp.kind) ?? 'CUSTOMER_KANBAN';
  const cropProfiles = doc
    ? [
        ...profiles.filter((p) => p.customerId === doc.customerId),
        ...profiles.filter((p) => p.customerId !== doc.customerId),
      ]
    : profiles;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Logistik' }, { label: 'Kanban' }]}
        title="Dokumen Customer"
        description="Upload kanban, manifest, dan skid label dari portal customer. Cetak arsipnya melalui Preparation Monitoring."
      />
      <CustomerDocumentUpload
        key={`${target?.id ?? 0}:${kind}`}
        profiles={profiles}
        initialTarget={target}
        initialKind={kind}
      />
      <Card>
        <CardHeader
          icon={Scissors}
          title="Master pemotongan"
          subtitle="Tambah dan geser garis tidur atau garis berdiri langsung di atas PDF customer."
        />
        <KanbanCropManager initialProfiles={cropProfiles} />
      </Card>
    </>
  );
}
