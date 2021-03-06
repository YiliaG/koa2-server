import KoaRouter from 'koa-router'
import fs from 'fs'
import { resolve } from 'path'
import { compose, isNull, format } from '../utils/util'
import { verifyToken } from '../utils/token'
import { ERR_SUCCESS,ERR_FAILURE,ERR_CEASE } from '../utils/http-status'

const pathPrefix = Symbol('pathPrefix')
const routeMap = []

export class Route {
  constructor(app, routesPath) {
    this.app = app
    this.router = new KoaRouter()
    this.routesPath = routesPath
  }
  init() {
    const { app, router, routesPath } = this
    let files = fs.readdirSync(routesPath)
    files.filter((f) => {
      if (f.endsWith('.js')) {
        require(resolve(__dirname, routesPath, f))
      }
      return;
    }, files)
    for (let { target, method, path, callback } of routeMap) {
      const prefix = target[pathPrefix]
      router[method](prefix + path, ...callback)
    }
    router.get('/erro/setlog', async (ctx) => {
      const { query } = ctx
      logger('client', {...query})
      ctx.body = {
        code: ERR_SUCCESS
      }
    })
    app.on("error", (err, ctx) => {
      // 捕获异常记录错误日志
      logger('server', {
        token: ctx.header.authorization,
        text: err.message,
        routerUrl: ctx._matchedRoute,
        query: ctx.query,
        params: ctx.params
      })
    })
    app.use(router.routes())
    app.use(router.allowedMethods())
  }
}

export const Controller = path => target => {
  return target.prototype[pathPrefix] = path
}

export const setRouter = method => path => (target, key, descriptor) => {
  routeMap.push({
    target,
    method,
    path,
    callback: compose(target[key])
  })
  return descriptor
}

export const Get = setRouter('get')

export const Post = setRouter('post')

export const convert = middleware => (target, key, descriptor) => {
  target[key] = compose(target[key], middleware)
  return descriptor
}

export const Required = paramsObj => convert(async (ctx, next) => {
  let erros = []
  for (let [key, value] of Object.entries(paramsObj)) {
    const ck = ctx.request[key]
    for (let k of value) {
      if (ck) {
        isNull(ck[k]) && erros.push(k)
      } else {
        console.error(`ctx don't have the ctx.${key}'s params`)
      }
    }
  }
  if (erros.length > 0) {
    return (
      ctx.body = {
        code: ERR_FAILURE,
        message: `${erros.join(', ')} is required`,
        data: {}
      }
    )
  }
  await next()
})

export const Auth = convert(async (ctx, next) => {
  const token = ctx.header.authorization
  let code = ERR_SUCCESS, message = ''
  if(token && token.indexOf('Bearer ') > -1){
    const t = await verifyToken(token.split('Bearer ')[1])
    if (!t.verify) {
      code = ERR_CEASE
      message = t.msg
    }
  } else {
    code = ERR_CEASE
    message = 'permission denied'
  }
  if (code === ERR_CEASE) {
    ctx.body = {
      code,
      message,
      data: {}
    }
    return
  }
  await next()
})

const logger = (dir, err) => {
  const date = new Date()
  const fileName = format(date, '$1-$2-$3')
  const filePath = resolve(__dirname, `../log/${dir}/${fileName}.log`)
  let json = []
  const erro = {
    ...err,
    time: format(date, '$4:$5:$6')
  }
  if (fs.existsSync(filePath)) {
    let text = fs.readFileSync(filePath, 'utf-8')
    json = JSON.parse(text)
  }
  json.push(erro)
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2),)
}

