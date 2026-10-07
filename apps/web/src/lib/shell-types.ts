export type GlobalSearchResult = {
  type: 'Part' | 'Kanban' | 'Pengiriman' | 'Penerimaan' | 'Supplier';
  title: string;
  subtitle: string;
  href: string;
  icon: string;
};

export type NavNotification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: 'warn' | 'danger';
  count: number;
};
