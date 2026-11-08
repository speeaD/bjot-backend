// Model PostgreSQL's shared/exclusive row locks and transaction advisory locks.
// Transactions run concurrently; only conflicting SQL locks make them wait.
function transactionLocks(database, onOptions = () => {}) {
  const resources = new Map();
  const events = [];
  let sequence = 0;

  function resource(key) {
    if (!resources.has(key)) resources.set(key, { holders: new Map(), queue: [] });
    return resources.get(key);
  }
  function available(lock, owner, mode) {
    return [...lock.holders].every(([id, held]) => id === owner || (mode === 'shared' && held === 'shared'));
  }
  function drain(lock) {
    while (lock.queue.length) {
      const next = lock.queue[0];
      if (!available(lock, next.owner, next.mode)) break;
      lock.queue.shift();
      lock.holders.set(next.owner, next.mode);
      next.resolve();
    }
  }
  async function acquire(owner, key, mode) {
    const lock = resource(key);
    if (lock.holders.has(owner)) return;
    if (!lock.queue.length && available(lock, owner, mode)) lock.holders.set(owner, mode);
    else await new Promise((resolve) => { lock.queue.push({ owner, mode, resolve }); });
    events.push({ owner, key, mode });
  }

  async function transaction(run, options) {
    const owner = ++sequence;
    onOptions(options);
    const tx = Object.create(database);
    tx.$queryRaw = async (parts, ...values) => {
      const sql = parts.join('');
      if (sql.includes('pg_advisory_xact_lock')) {
        await acquire(owner, `advisory:${values[0]}`, 'exclusive');
      } else if (sql.includes('FROM quizzes')) {
        await acquire(owner, `quiz:${values[0]}`, sql.includes('FOR SHARE') ? 'shared' : 'exclusive');
      } else throw new Error(`Unsupported test SQL: ${sql}`);
      return database.$queryRaw?.(parts, ...values) || [];
    };
    try {
      return await run(tx);
    } finally {
      for (const lock of resources.values()) lock.holders.delete(owner);
      for (const lock of resources.values()) drain(lock);
    }
  }
  return { transaction, events };
}

module.exports = { transactionLocks };
