import type { Band } from "@/lib/money";

export interface Me { id: string; email: string; fullName: string; role: "owner" | "adviser"; orderPrefix: string | null }
export interface Settings { todaysRateSdgPerUsd: number; minRateSdgPerUsd: number; sandMaxBp: number; redMaxBp: number; updatedAt: string }
export interface Product { id: string; sku: string; name: string; priceUsdCents: number }
export interface Customer { id: string; name: string; city: string }
export interface Bootstrap { me: Me; settings: Settings; products: Product[]; customers: Customer[] }

export interface SavedLine {
  lineNo: number;
  product: { id: string; sku: string; name: string };
  quantity: number;
  unitPriceUsdCents: number;
  lineValueUsdCents: number;
  discountUsdCents: number;
  discountBp: number;
  band: Band;
  lineTotalUsdCents: number;
  approvedByName: string | null;
  approvedAt: string | null;
}

export interface SavedOrder {
  id: string;
  orderNumber: string;
  customer: Customer;
  adviserName: string;
  savedByName: string;
  rateSdgPerUsd: number;
  totalUsdCents: number;
  totalSdgPiastres: number;
  savedAt: string;
  createdOnDeviceAt: string | null;
  lines: SavedLine[];
}

export interface OrderSummary {
  id: string; orderNumber: string; customerName: string; rateSdgPerUsd: number;
  totalUsdCents: number; totalSdgPiastres: number; savedAt: string; adviserName: string;
}

export interface OrderPayload {
  id: string;
  customerId: string;
  rateSdgPerUsd: number;
  lines: { productId: string; quantity: number; unitPriceUsdCents: number; discountUsdCents: number; approve?: boolean }[];
  expected: { totalUsdCents: number; totalSdgPiastres: number };
  createdOnDeviceAt: string;
}

export interface ApprovalRequest {
  id: string; status: "pending" | "approved"; rateSdgPerUsd: number; createdAt: string; orderId: string | null;
  customerId: string; customerName: string; requestedByName: string;
  lines: { productId: string; quantity: number; unitPriceUsdCents: number; discountUsdCents: number }[];
}
