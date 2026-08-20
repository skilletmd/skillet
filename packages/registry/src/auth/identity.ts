// Two identity value spaces that are both stored as TEXT and are easy to
// confuse — the source of a whole class of silent-wrong-join bugs:
//
//   Handle  — the public namespace key. `authors.id` and `users.handle`
//             (e.g. "taylor"). Also owns org slugs and unclaimed mirror brands.
//             Held by author_id / owner_id / published_by / proposer_author_id.
//   UserId  — an opaque account UUID. `users.id`. Held by every *.user_id FK
//             (devices, sessions, kit_members, mcp_links, …).
//
// The invariant that bridges them — `authors.id = users.handle` — is enforced
// nowhere in the schema (see lib/enforcement.ts). Branding the two makes the
// compiler reject mixing them in typed code: `handle === userId` and passing a
// Handle where a UserId is expected (or vice versa) become type errors. SQL
// string literals are still unchecked — this guards the TS boundary, which is
// where the resolved principal and its comparisons live.

declare const HandleBrand: unique symbol;
declare const UserIdBrand: unique symbol;

/** Public namespace key: `authors.id` / `users.handle` (e.g. "taylor"). */
export type Handle = string & { readonly [HandleBrand]: true };
/** Opaque account id: `users.id` (a UUID). */
export type UserId = string & { readonly [UserIdBrand]: true };

/** Tag a raw string as a Handle at a trust boundary (a DB read, a parsed ref). */
export const asHandle = (s: string): Handle => s as Handle;
/** Tag a raw string as a UserId at a trust boundary (a DB read). */
export const asUserId = (s: string): UserId => s as UserId;

// Compile-time guards (types only, no runtime cost). `tsc` fails here if the two
// brands ever collapse into the same type, or if a raw `string` becomes freely
// assignable to a brand — i.e. if the protection this file exists for is lost.
/* eslint-disable @typescript-eslint/no-unused-vars -- Assert<> guards are type-only */
type Assert<T extends true> = T;
type _HandleIsNotUserId = Assert<Handle extends UserId ? false : true>;
type _UserIdIsNotHandle = Assert<UserId extends Handle ? false : true>;
type _StringIsNotHandle = Assert<string extends Handle ? false : true>;
type _StringIsNotUserId = Assert<string extends UserId ? false : true>;
/* eslint-enable @typescript-eslint/no-unused-vars */
