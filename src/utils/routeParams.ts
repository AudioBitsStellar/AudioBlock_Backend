/**
 * Express 5 types a route parameter as `string | string[]`, because a path can
 * declare the same name more than once. Route handlers here always declare a
 * parameter once, so this narrows to the single value and keeps the
 * `Array.isArray` check in one place rather than at every call site.
 *
 * @param value - Raw `req.params` entry
 * @returns The single parameter value, or the first when Express supplied several
 */
export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}
