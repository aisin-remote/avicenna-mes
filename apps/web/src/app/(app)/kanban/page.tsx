import { Scissors } from 'lucide-react';
import { listKanbanCropProfiles } from '@/lib/kanban-crop-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { KanbanCropManager } from '@/components/delivery/kanban-crop-manager';

export const dynamic = 'force-dynamic';

export default async function KanbanPage() {
  const profiles = await listKanbanCropProfiles();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Logistik' }, { label: 'Kanban' }]}
        title="Kanban"
        description="Master garis potong PDF Kanban per customer."
      />
      <Card>
        <CardHeader
          icon={Scissors}
          title="Master pemotongan"
          subtitle="Tambah dan geser garis tidur atau garis berdiri langsung di atas PDF customer."
        />
        <KanbanCropManager initialProfiles={profiles} />
      </Card>
    </>
  );
}
