from django.test import SimpleTestCase

from config.redis_settings import resolve_redis_urls


class RedisUrlResolutionTests(SimpleTestCase):
    def test_empty(self):
        urls = resolve_redis_urls()
        self.assertEqual(urls["cache"], "")
        self.assertEqual(urls["broker"], "")
        self.assertEqual(urls["result"], "")

    def test_shared_redis_url_splits_dbs(self):
        urls = resolve_redis_urls(redis_url="redis://:secret@127.0.0.1:6379/5")
        self.assertEqual(urls["cache"], "redis://:secret@127.0.0.1:6379/0")
        self.assertEqual(urls["broker"], "redis://:secret@127.0.0.1:6379/1")

    def test_explicit_urls_win(self):
        urls = resolve_redis_urls(
            redis_url="redis://:secret@127.0.0.1:6379/0",
            redis_cache_url="redis://:secret@cache:6379/0",
            celery_broker_url="redis://:secret@broker:6379/0",
            celery_result_backend="redis://:secret@broker:6379/2",
        )
        self.assertEqual(urls["cache"], "redis://:secret@cache:6379/0")
        self.assertEqual(urls["broker"], "redis://:secret@broker:6379/0")
        self.assertEqual(urls["result"], "redis://:secret@broker:6379/2")
