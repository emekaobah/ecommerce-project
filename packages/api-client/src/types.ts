import type { MedusaResponse } from "@medusajs/framework/http"

// Route → client type inference. Mirrors @mercurjs/client's `InferClient`, which
// types inputs only from `validatedBody`. Routes that type their query via
// `validatedQuery` (e.g. Medusa's store products, so `region_id`) reject query
// params, and every GET requires an argument. Here GET inputs also accept query
// fields and are optional. Drop this for `InferClient` once upstream reads
// `validatedQuery`.
// Routes whose handlers don't type their response (e.g. Mercur's store products)
// still yield `unknown`.

type HttpMethod = "GET" | "POST" | "DELETE"
type ChildKeys<T> = Exclude<keyof T, HttpMethod | "__esModule">
type WithFetchOptions<T> = T & { fetchOptions?: RequestInit }

type InferBody<TRequest> = TRequest extends { validatedBody: infer B }
  ? unknown extends B
    ? void
    : B
  : void
type InferQuery<TRequest> = TRequest extends { validatedQuery: infer Q }
  ? Partial<Q> & Record<string, unknown>
  : Record<string, unknown>
type InferOutput<TResponse> = TResponse extends MedusaResponse<infer O> ? O : unknown

type Fn<TInput, TOutput> = [TInput] extends [void]
  ? (input?: WithFetchOptions<{}>) => Promise<TOutput>
  : (input: WithFetchOptions<TInput>) => Promise<TOutput>

type QueryFn<TInput, TOutput> = (input?: WithFetchOptions<TInput>) => Promise<TOutput>

type AddParams<F, TParams> = keyof TParams extends never
  ? F
  : F extends (input?: infer I) => infer O
    ? (input: (I extends object ? I : {}) & TParams) => O
    : F

type Methods<TRoute, TParams> = (TRoute extends { GET: (req: infer Req, res: infer Res) => any }
  ? { query: AddParams<QueryFn<InferQuery<Req>, InferOutput<Res>>, TParams> }
  : {}) &
  (TRoute extends { POST: (req: infer Req, res: infer Res) => any }
    ? { mutate: AddParams<Fn<InferBody<Req>, InferOutput<Res>>, TParams> }
    : {}) &
  (TRoute extends { DELETE: (req: infer Req, res: infer Res) => any }
    ? { delete: AddParams<Fn<void, InferOutput<Res>>, TParams> }
    : {})

type Process<TRoutes, TParams = {}> = Methods<TRoutes, TParams> & {
  [K in ChildKeys<TRoutes>]: K extends `$${string}`
    ? Process<TRoutes[K], TParams & { [P in K]: string }>
    : Process<TRoutes[K], TParams>
}

export type TypedClient<TRoutes> = Process<TRoutes>
