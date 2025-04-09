class FifoCache<K, V> {
  private maxSize: number;
  private currentIndex: number;
  private keys: Array<K | undefined>;
  private cache: Map<K, V>;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.currentIndex = 0;
    // Pre-allocate the array to the max size
    this.keys = new Array(maxSize);
    this.cache = new Map();
  }

  /**
   * Sets the value for the given key. If the key already exists,
   * its value is updated without changing its FIFO position.
   * If it's a new key and the cache is full, the oldest key is evicted.
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update the value for existing key
      this.cache.set(key, value);
      return;
    }
    // Evict the key at the current circular index (if it exists)
    const evictedKey = this.keys[this.currentIndex];
    if (evictedKey !== undefined) {
      this.cache.delete(evictedKey);
    }
    // Insert the new key in the circular buffer and cache
    this.keys[this.currentIndex] = key;
    this.cache.set(key, value);
    // Move to the next position in the circular buffer
    this.currentIndex = (this.currentIndex + 1) % this.maxSize;
  }

  /**
   * Retrieves the value associated with the key.
   */
  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  /**
   * Checks if a key exists in the cache.
   */
  exists(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * For debugging: logs the current state of the cache.
   */
  debug() {
    console.log("Cache Map:", this.cache);
    console.log("Circular Buffer Keys:", this.keys);
  }
}

export default FifoCache;
