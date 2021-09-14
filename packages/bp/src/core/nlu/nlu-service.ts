import { IO, Logger } from 'botpress/sdk'
import { ConfigProvider } from 'core/config'
import { WellKnownFlags } from 'core/dialog'
import { EventEngine } from 'core/events'
import { TYPES } from 'core/types'
import { inject, injectable, postConstruct } from 'inversify'
import { AppLifecycle, AppLifecycleEvents } from 'lifecycle'
import _ from 'lodash'
import yn from 'yn'
import legacyElection from './election/legacy-election'
import naturalElection from './election/natural-election'
import pickSpellChecked from './election/spellcheck-handler'
import { NLUClient } from './nlu-client'
import { Predictor } from './predictor'

const EVENTS_TO_IGNORE = ['session_reference', 'session_reset', 'bp_dialog_timeout', 'visit', 'say_something', '']
const PREDICT_MW = 'nlu-predict.incoming'

interface Config {
  legacyElection: boolean
  nluEndpoint: string
}

/**
 * This service takes care of the nlu inferences/predictions
 *
 * It belongs in the runtime and only in the runtime.
 * It is not responsible for CRUD on intent and entity files.
 * It is not responsible for training and the model state-machine.
 * It expects botConfig to expose nluModels.
 * That's it.
 */
@injectable()
export class NLUService {
  private config!: Config
  private client!: NLUClient
  private predictors: { [botId: string]: Predictor } = {}

  constructor(
    @inject(TYPES.EventEngine) private eventEngine: EventEngine,
    @inject(TYPES.ConfigProvider) private configProvider: ConfigProvider,
    @inject(TYPES.Logger) private logger: Logger
  ) {}

  @postConstruct()
  public async initialize(opt: Partial<Config> = {}) {
    await AppLifecycle.waitFor(AppLifecycleEvents.STUDIO_READY)

    const defaultConfig: Config = { legacyElection: false, nluEndpoint: `http://localhost:${process.NLU_PORT}` }
    this.config = { ...defaultConfig, ...opt }
    this.client = new NLUClient(this.config.nluEndpoint)

    this.eventEngine.register({
      name: PREDICT_MW,
      description:
        'Process natural language in the form of text. Structured data with an action and parameters for that action is injected in the incoming message event.',
      order: 100,
      direction: 'incoming',
      handler: this.handleIncomingEvent.bind(this)
    })
  }

  public async teardown() {
    await AppLifecycle.waitFor(AppLifecycleEvents.STUDIO_READY)
    this.eventEngine.removeMiddleware(PREDICT_MW)
  }

  public async mountBot(botId: string) {
    await AppLifecycle.waitFor(AppLifecycleEvents.STUDIO_READY)
    const botConfig = await this.configProvider.getBotConfig(botId)
    const modelIdGetter = this._modelIdGetter(botId)
    const predictor = new Predictor(botId, botConfig.defaultLanguage, this.client, modelIdGetter, this.logger)
    this.predictors[botId] = predictor
  }

  public async unmountBot(botId: string) {
    delete this.predictors[botId]
  }

  private _modelIdGetter = (botId: string) => async (): Promise<Dic<string>> => {
    // TODO: implement some caching to prevent from reading config at each predict
    const botConfig = await this.configProvider.getBotConfig(botId)
    return botConfig.nluModels ?? {}
  }

  private handleIncomingEvent = async (event: IO.Event, next: IO.MiddlewareNextCallback) => {
    if (!this._isIncoming(event)) {
      const err = new Error('NLU incoming mw should receive incoming event.')
      return next(err)
    }

    if (await this._ignoreEvent(event)) {
      return next(undefined, false, true)
    }

    try {
      const { botId, preview } = event
      const anticipatedLanguage: string | undefined = event.state.user?.language

      const bot = this.predictors[botId]
      if (!bot) {
        const err = new Error(`No predictor found for bot "${botId}" in nlu service.`)
        return next(err)
      }

      const t0 = Date.now()

      const predOutput = await bot.predict(preview, anticipatedLanguage)
      const includedContexts = event.nlu?.includedContexts ?? []

      const appendTime = <T>(eu: T) => ({ ...eu, ms: Date.now() - t0 })

      let nluResults = { ...predOutput, includedContexts }
      if (nluResults.spellChecked && nluResults.spellChecked !== preview && !yn(process.env.NLU_SKIP_SPELLCHECK)) {
        const predOutput = await bot.predict(nluResults.spellChecked, anticipatedLanguage)
        const spellCheckedResults = { ...predOutput, includedContexts }
        nluResults = pickSpellChecked(appendTime(nluResults), appendTime(spellCheckedResults))
      }

      const electionInput = appendTime(nluResults)
      const postElection = this.config.legacyElection ? legacyElection(electionInput) : naturalElection(electionInput)
      _.merge(event, { nlu: postElection })
      this.removeSensitiveText(event)
    } catch (err) {
      this.logger.warn(`Error extracting metadata for incoming text: ${err.message}`)
    } finally {
      next()
    }
  }

  private removeSensitiveText = (event: IO.IncomingEvent) => {
    if (!event.nlu || !event.nlu.entities || !event.payload.text) {
      return
    }

    try {
      const sensitiveEntities = event.nlu.entities.filter(ent => ent.meta.sensitive)
      for (const entity of sensitiveEntities) {
        const stars = '*'.repeat(entity.data.value.length)
        event.payload.text = event.payload.text.replace(entity.data.value, stars)
      }
    } catch (err) {
      this.logger.warn(`Error removing sensitive information: ${err.message}`)
    }
  }

  private _ignoreEvent = async (event: IO.IncomingEvent) => {
    const { health } = await this.client.getInfo()
    return (
      !this.predictors[event.botId] ||
      !health?.isEnabled ||
      !event.preview ||
      EVENTS_TO_IGNORE.includes(event.type) ||
      event.hasFlag(WellKnownFlags.SKIP_NATIVE_NLU)
    )
  }

  private _isIncoming = (e: IO.Event): e is IO.IncomingEvent => {
    return e.direction === 'incoming'
  }
}
