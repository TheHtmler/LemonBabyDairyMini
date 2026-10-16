'use strict';

const { fail } = require('./lib/core/contracts');
const { observationPatch } = require('./lib/core/normalize');
const { runtime, assertAccess, ownedSession, publicFailure, SESSION_COLLECTION, hash } = require('./lib/core/server');
const { prepareSession, claimRecognition } = require('./sessionRepository');
const { resolveConfig, callRecognitionModel, callNutritionEstimateModel } = require('./modelClient');
const { resolveImages } = require('./imageReader');
const { estimateNutrition } = require('./estimateService');
const { bindPreviewTarget } = require('./targetBinding');
const { featureAccess, getAiPolicy, requireAiPolicy, usageStatus, reserveInvocation, markDispatched, completeInvocation } = require('./lib/ai');

function createRecognitionHandler({ cloud, db, context, env, allocateFileIds, imageReader = resolveImages,
  modelClient = callRecognitionModel, estimateClient = callNutritionEstimateModel, now = Date.now, config = process.env }) {
  return async (event = {}) => {
    let stage = 'access_check';
    const action = event.action || 'recognize';
    const setStage = value => { stage = value; };
    try {
      await assertAccess(db, context.OPENID, event.babyUid);
      if (!['capabilities', 'prepare', 'recognize', 'estimate', 'bindTarget'].includes(action)) fail('INVALID_INPUT', '不支持的识别操作');
      if (action === 'bindTarget') return await bindPreviewTarget({ db, openid: context.OPENID, event, now: now() });
      const flags = await featureAccess(db, context.OPENID);
      if (action === 'capabilities') {
        const policy = getAiPolicy({ scene: 'scan', env: config });
        if (!flags.nutrition_scan_enabled) return { ok: true, enabled: false, available: false,
          reasonCode: 'FEATURE_DISABLED', message: '拍照识别已关闭', remaining: 0 };
        if (!policy.available) return { ok: true, enabled: true, available: false,
          reasonCode: 'CONFIG_MISSING', message: '识别服务尚未准备好，请稍后重试', remaining: 0 };
        resolveConfig({ ...config, BAILIAN_MODEL: policy.primaryModel, NUTRITION_FALLBACK_MODEL: policy.fallbackModel || '' });
        const quota = await usageStatus(db, context.OPENID, 'scan', policy.dailyLimit, now());
        return { ok: true, enabled: true, available: quota.available, remaining: quota.remaining,
          reasonCode: quota.available ? '' : 'DAILY_LIMIT', message: quota.available ? '' : '今日识别次数已用完，明天可继续识别' };
      }
      if (!flags.nutrition_scan_enabled) fail('AI_UNAVAILABLE', '拍照识别暂不可用，可以手动添加资料');
      if (event.action === 'estimate') {
        const policy = requireAiPolicy({ scene: 'scan', env: config });
        return await estimateNutrition({ db, openid: context.OPENID,
          config: { ...config, BAILIAN_MODEL: policy.primaryModel, NUTRITION_FALLBACK_MODEL: policy.fallbackModel || '' },
          modelClient: async options => {
            const reservation = await reserveInvocation({ db, openid: context.OPENID, babyUid: event.babyUid, scene: 'scan', requestId: hash('estimate:' + event.sessionId + ':' + event.requestId), requestHash: hash(JSON.stringify([event.sessionId, event.comparisonVersion, options.identity])), now: now(), dailyLimit: policy.dailyLimit });
            if (reservation.state === 'cached') return reservation.result;
            let dispatched = false; let model;
            try { await markDispatched(db, reservation); dispatched = true; model = await estimateClient(options); await completeInvocation({ db, reservation, result: model, usage: model.usage, dispatched }); return model; }
            catch (error) { await completeInvocation({ db, reservation, error, usage: model && model.usage || error.usage || null, dispatched }).catch(() => {}); throw error; }
          }, now }, event, setStage);
      }
      if (event.action === 'prepare') {
        // 模型尚未就绪时先提示原因，避免用户上传图片后才发现识别无法执行。
        const policy = requireAiPolicy({ scene: 'scan', env: config });
        resolveConfig({ ...config, BAILIAN_MODEL: policy.primaryModel, NUTRITION_FALLBACK_MODEL: policy.fallbackModel || '' });
        // 等待准备流程完成，异步异常才能在这里保留具体出错阶段。
        return await prepareSession(db, context.OPENID, event, env, now(), allocateFileIds, setStage);
      }
      stage = 'session_read';
      const session = await ownedSession(db, context.OPENID, event.babyUid, event.sessionId, now());
      if (event.requestId && event.requestId !== session.requestId) fail('REQUEST_CONFLICT', '识别请求编号与草稿不同');
      if (session.result) return { ...session.result, sessionId: event.sessionId };
      if (session.status === 'failed') return session.failure;
      if (session.status === 'recognizing') fail(session.recognitionLeaseUntil > now() ? 'RECOGNITION_IN_PROGRESS' : 'AI_UNKNOWN', session.recognitionLeaseUntil > now() ? '识别正在处理，请稍后再查看' : '上次识别结果暂不可确认，请主动重新识别');
      if (!['recognize', undefined].includes(event.action)) fail('INVALID_INPUT', '不支持的识别操作');
      stage = 'model_config';
      const policy = requireAiPolicy({ scene: 'scan', env: config });
      const modelConfig = resolveConfig({ ...config, BAILIAN_MODEL: policy.primaryModel, NUTRITION_FALLBACK_MODEL: policy.fallbackModel || '' });
      stage = 'image_read';
      const images = await imageReader(cloud, event.fileIDs, session, env);
      stage = 'session_claim';
      const reservation = await reserveInvocation({ db, openid: context.OPENID, babyUid: event.babyUid, scene: 'scan', requestId: session.requestId,
        requestHash: hash(JSON.stringify([event.sessionId, session.requestedMode || session.mode, event.fileIDs])), now: now(), dailyLimit: policy.dailyLimit });
      if (reservation.state === 'cached') return reservation.result;
      let dispatched = false; let model;
      try {
        if (!await claimRecognition(db, event.sessionId, now())) fail('RECOGNITION_IN_PROGRESS', '识别正在处理，请稍后再查看');
        stage = 'model_request';
        await markDispatched(db, reservation); dispatched = true;
        model = await modelClient({ images, mode: session.mode, categoryCatalog: session.categoryCatalog,
          ...modelConfig, deadline: now() + 25000 });
        const resolvedMode = model.resolvedMode || session.mode;
        const unresolved = ['uncertain', 'unsupported'].includes(resolvedMode);
        const result = { ok: true, requestId: session.requestId, mode: resolvedMode, resolvedMode,
          observation: model.observation, identityCandidates: model.observation.identityCandidates, patch: unresolved ? {} : observationPatch(model.observation, resolvedMode),
          missingFields: model.observation.missingFields, warnings: model.observation.warnings,
          evidence: Object.fromEntries(Object.entries(model.observation.nutrients).filter(([, value]) => value.evidence)
            .map(([key, value]) => [key, value.evidence])),
          originalBasis: model.observation.basis, classification: model.classification || null,
          usage: model.usage, modelInfo: model.modelInfo };
        stage = 'session_save';
        await db.collection(SESSION_COLLECTION).doc(event.sessionId).update({
          status: unresolved ? 'needs_type' : 'recognized', mode: resolvedMode, observation: model.observation, result, fileIDs: event.fileIDs, version: session.version + 2
        });
        await completeInvocation({ db, reservation, dispatched, result: { ...result, sessionId: event.sessionId }, usage: model.usage });
        return { ...result, sessionId: event.sessionId };
      } catch (error) {
        await completeInvocation({ db, reservation, dispatched, error, usage: model && model.usage || error.usage || null }).catch(() => {});
        const failure = publicFailure(error, session.requestId, { action, stage });
        await db.collection(SESSION_COLLECTION).doc(event.sessionId).update({ status: 'failed', failure }).catch(() => {});
        return failure;
      }
    } catch (error) { return publicFailure(error, event.requestId, { action, stage }); }
  };
}

exports.main = async event => {
  try { return await createRecognitionHandler(runtime())(event); }
  catch (error) { return publicFailure(error, event && event.requestId,
    { action: event && event.action || 'recognize', stage: 'runtime_init' }); }
};
exports.createRecognitionHandler = createRecognitionHandler;
