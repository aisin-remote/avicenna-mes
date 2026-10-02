import {
  Factory,
  GitBranch,
  Package,
  Users,
  Truck,
  Cog,
  Wrench,
  MapPin,
  TriangleAlert,
  LayoutDashboard,
  Activity,
  Database,
  ScanLine,
  Network,
  MoveRight,
  PackageCheck,
  Share2,
  Route,
  Tag,
  Hash,
  Boxes,
  Scissors,
  type LucideIcon,
} from 'lucide-react';

/**
 * Pemetaan nama ikon (string) ke komponennya.
 *
 * Definisi entitas di @avicenna/contracts menyebut ikon sebagai string, bukan
 * komponen — kontrak itu dipakai juga oleh API yang tidak punya React sama
 * sekali. Penerjemahannya dilakukan di sini, di sisi UI.
 */
const ICONS: Record<string, LucideIcon> = {
  Factory,
  GitBranch,
  Package,
  Users,
  Truck,
  Cog,
  Wrench,
  MapPin,
  TriangleAlert,
  LayoutDashboard,
  Activity,
  ScanLine,
  Network,
  MoveRight,
  PackageCheck,
  Share2,
  Route,
  Tag,
  Hash,
  Boxes,
  Scissors,
};

/** Mengembalikan ikon Database sebagai cadangan agar UI tidak pernah kosong. */
export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Database;
}
