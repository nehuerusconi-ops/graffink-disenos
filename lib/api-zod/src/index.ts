// Re-export the Zod runtime schemas (values) from the generated API module.
export * from "./generated/api";

// Re-export the type-only symbols from the generated/types barrel.
//
// orval emits some symbols in *both* modules — Zod schemas in
// `./generated/api` (e.g. `CapturePaypalOrderBody`, `RequestUploadUrlBody`)
// and type-only counterparts in `./generated/types`. A plain
// `export * from "./generated/types"` triggers TS2308 ("ambiguous
// re-export") on those duplicate names. To stay correct under
// `isolatedModules`, list each type explicitly here and skip the ones
// already covered by the Zod schemas (their inferred shape is reachable
// via `z.infer<typeof Schema>`).
//
// Update this list when a new schema is added to `openapi.yaml`.
export type {
  AppSettings,
  AppSettingsInput,
  Category,
  CategoryInput,
  CheckoutInput,
  CheckoutInputItemsItem,
  CreateMercadoPagoPreference200,
  CreatePaypalOrder200,
  ErrorResponse,
  GetOrderInvoice200,
  GetTransferenciaInfo200,
  HealthStatus,
  Order,
  OrderConfirmationSource,
  OrderInput,
  OrderInputPaymentMethod,
  OrderItem,
  OrderPaymentMethod,
  OrderStats,
  OrderStatsRevenueByDayItem,
  OrderStatsRevenueByMethodItem,
  OrderStatsTopProductsItem,
  OrderStatus,
  Product,
  ProductInput,
  ProductSpec,
  ProductUpdate,
  RequestUploadUrl200,
  WebhookSecurityEvent,
} from "./generated/types";
