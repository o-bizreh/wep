export interface MonitoredRepo {
  owner: string;
  name: string;
  /** full name: owner/name */
  fullName: string;
  addedBy: string;
  addedAt: string;
  lastScannedAt: string | null;
  lastScanStatus: 'pending' | 'scanning' | 'done' | 'failed';
  lastScanError: string | null;
  packageCount: number;
}
