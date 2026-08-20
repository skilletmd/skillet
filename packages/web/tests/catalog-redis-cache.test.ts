import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redisMocks = vi.hoisted(() => {
  const get = vi.fn()
  const set = vi.fn()
  const connect = vi.fn(async () => undefined)
  const on = vi.fn()
  const Redis = vi.fn(function RedisMock(this: {
    get: typeof get
    set: typeof set
    connect: typeof connect
    on: typeof on
    status: string
  }) {
    this.get = get
    this.set = set
    this.connect = connect
    this.on = on
    this.status = 'wait'
    return this
  })
  return { get, set, connect, on, Redis }
})

vi.mock('ioredis', () => ({
  default: redisMocks.Redis,
}))

describe('redis-connection', () => {
  beforeEach(() => {
    redisMocks.Redis.mockClear()
    delete process.env.REDIS_URL
    delete process.env.SKILLET_REDIS_URL
    delete process.env.REDIS_PROD
    delete process.env.REDIS_SENTINELS
    delete process.env.REDIS_MAIN_NAME
    delete process.env.REDIS_PASSWORD
    delete process.env.REDIS_CACHE_DB
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('parses REDIS_SENTINELS JSON', async () => {
    const { parseRedisSentinelsForTests } = await import('@/lib/redis-connection')
    expect(
      parseRedisSentinelsForTests(
        '[{"host":"10.0.0.1","port":26379},{"host":"10.0.0.2","port":26379}]',
      ),
    ).toEqual([
      { host: '10.0.0.1', port: 26379 },
      { host: '10.0.0.2', port: 26379 },
    ])
    expect(parseRedisSentinelsForTests('not-json')).toBeNull()
  })

  it('builds a direct URL client when SKILLET_REDIS_URL is set', async () => {
    process.env.SKILLET_REDIS_URL = 'redis://127.0.0.1:6379/0'
    const { createCatalogRedisClient } = await import('@/lib/redis-connection')
    const client = createCatalogRedisClient()
    expect(client).not.toBeNull()
    expect(redisMocks.Redis).toHaveBeenCalledWith(
      'redis://127.0.0.1:6379/0',
      expect.objectContaining({ lazyConnect: true }),
    )
  })

  it('builds a Sentinel client when REDIS_PROD=true and REDIS_SENTINELS is set', async () => {
    process.env.REDIS_PROD = 'true'
    process.env.REDIS_SENTINELS = '[{"host":"10.1.2.3","port":26379}]'
    process.env.REDIS_MAIN_NAME = 'mymaster'
    process.env.REDIS_PASSWORD = 'secret'
    process.env.REDIS_CACHE_DB = '2'
    const { createCatalogRedisClient } = await import('@/lib/redis-connection')
    const client = createCatalogRedisClient()
    expect(client).not.toBeNull()
    expect(redisMocks.Redis).toHaveBeenCalledWith(
      expect.objectContaining({
        sentinels: [{ host: '10.1.2.3', port: 26379 }],
        name: 'mymaster',
        password: 'secret',
        db: 2,
        lazyConnect: true,
      }),
    )
  })

  it('returns null in Sentinel mode without REDIS_SENTINELS (no hardcoded hosts)', async () => {
    process.env.REDIS_PROD = 'true'
    delete process.env.REDIS_SENTINELS
    const { createCatalogRedisClient } = await import('@/lib/redis-connection')
    expect(createCatalogRedisClient()).toBeNull()
    expect(redisMocks.Redis).not.toHaveBeenCalled()
  })
})

describe('catalog-redis-cache', () => {
  beforeEach(() => {
    redisMocks.get.mockReset()
    redisMocks.set.mockReset()
    redisMocks.connect.mockReset()
    redisMocks.connect.mockResolvedValue(undefined)
    redisMocks.on.mockReset()
    redisMocks.Redis.mockClear()
    delete process.env.REDIS_URL
    delete process.env.SKILLET_REDIS_URL
    delete process.env.REDIS_PROD
    delete process.env.REDIS_SENTINELS
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns undefined and never connects when Redis URL is unset', async () => {
    const { catalogRedisGet, catalogRedisSet, resetCatalogRedisForTests } = await import(
      '@/lib/catalog-redis-cache'
    )
    resetCatalogRedisForTests()
    await expect(catalogRedisGet('k')).resolves.toBeUndefined()
    await catalogRedisSet('k', { ok: true })
    expect(redisMocks.Redis).not.toHaveBeenCalled()
  })

  it('gets and sets JSON when SKILLET_REDIS_URL is set', async () => {
    process.env.SKILLET_REDIS_URL = 'redis://127.0.0.1:6379'
    redisMocks.get.mockResolvedValue(JSON.stringify({ skills: [], total: 1 }))
    redisMocks.set.mockResolvedValue('OK')

    const { catalogRedisGet, catalogRedisSet, catalogRedisKey, resetCatalogRedisForTests } =
      await import('@/lib/catalog-redis-cache')
    resetCatalogRedisForTests()

    await expect(catalogRedisGet<{ total: number }>('skills?limit=24')).resolves.toEqual({
      skills: [],
      total: 1,
    })
    await catalogRedisSet('skills?limit=24', { skills: [], total: 2 })

    expect(redisMocks.get).toHaveBeenCalledWith(catalogRedisKey('skills?limit=24'))
    expect(redisMocks.set).toHaveBeenCalledWith(
      catalogRedisKey('skills?limit=24'),
      JSON.stringify({ skills: [], total: 2 }),
      'EX',
      60,
    )
  })

  it('fails open when get throws', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    redisMocks.get.mockRejectedValue(new Error('down'))

    const { catalogRedisGet, resetCatalogRedisForTests } = await import('@/lib/catalog-redis-cache')
    resetCatalogRedisForTests()
    await expect(catalogRedisGet('x')).resolves.toBeUndefined()
  })
})
