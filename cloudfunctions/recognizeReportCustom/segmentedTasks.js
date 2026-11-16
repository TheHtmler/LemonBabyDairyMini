'use strict';

// 失败任务可返回更小的子任务；成功任务不重跑，任一终止失败都会等待在途任务完成。
async function runSegmentedTasks(initial, handle, concurrency = 4) {
  const queue = [...initial];
  const running = new Set();
  let next = 0;
  let failure;
  while ((!failure && next < queue.length) || running.size) {
    while (!failure && next < queue.length && running.size < concurrency) {
      const task = queue[next++];
      const pending = Promise.resolve().then(() => handle(task))
        .then(children => ({ pending, children }), error => ({ pending, error }));
      running.add(pending);
    }
    const finished = await Promise.race(running);
    running.delete(finished.pending);
    if (finished.error) failure = failure || finished.error;
    else if (!failure && finished.children?.length) queue.push(...finished.children);
  }
  if (failure) throw failure;
}

module.exports = { runSegmentedTasks };
