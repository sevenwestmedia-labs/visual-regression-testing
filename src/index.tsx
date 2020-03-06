import 'isomorphic-fetch'
import React from 'react'
import path from 'path'
import fs from 'fs'
import http from 'http'
import getPort from 'get-port'
import { Viewport } from 'puppeteer-core'
import { render } from './render'
import {
    toMatchImageSnapshot,
    MatchImageSnapshotOptions,
} from './jest-image-snapshot'
import { PuppeteerFixture, SnapshotOptions } from 'tests/helpers/puppeteer-fixture'
import { Logger, consoleLogger } from 'typescript-log'

const stoppable: (server: http.Server) => http.Server & { stop: () => void } = require('stoppable')

export interface Render {
    html: string
    css: string
}

export interface VRTestFixture {
    takeSnapshot: VRTestFixtureInternal['takeSnapshot']
    addStyles: (styles: string) => void
}

export class VRTestFixtureInternal extends PuppeteerFixture implements VRTestFixture {
    httpServer: http.Server & { stop: () => void }
    additionalStyles = ''
    renderResult!: string
    port!: number

    constructor(logger: Logger, private render: (element: JSX.Element) => ({html: string, css: string}))  {
        super(logger)

        // First lets create a http server
        this.httpServer = stoppable(
            http.createServer(async (req, res) => {
                if (req.url) {
                    if (req.url.indexOf('/assets') === 0) {
                        const fontPath = path.join(__dirname, '../../..', req.url)
                        const fontFile = fs.readFileSync(fontPath)
                        res.writeHead(200, { 'Content-Type': 'application/font-woff' })
                        res.end(fontFile, 'binary')

                        return
                    }

                    if (req.url.indexOf('/src') === 0) {
                        const strippedImageUrl = req.url.split('?')[0]
                        const imageFile = fs.readFileSync(path.resolve(`.${strippedImageUrl}`))
                        if (req.url.match(/.svg$/)) {
                            res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
                        } else {
                            res.writeHead(200, { 'Content-Type': 'image/jpg' })
                        }
                        res.end(imageFile, 'binary')

                        return
                    }
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                res.write(this.renderResult, 'utf8')
                res.end()
            })
        )
    }

    takeSnapshot = async (target: JSX.Element, options: SnapshotOptions = {}) => {

        const {html, css} = this.render.(target)

        if (typeof options.viewPortSize === 'string') {
            const deviceDetails: {
                viewport: Viewport
                userAgent: string
            } = require('puppeteer-core/DeviceDescriptors')[options.viewPortSize]
            console.log(`Emulating ${options.viewPortSize}:`, deviceDetails)

            const watchDog = this.page.waitForFunction(
                `window.innerWidth - 10 <= ${deviceDetails.viewport.width}`
            )
            await this.page.emulate({
                viewport: {
                    width: deviceDetails.viewport.width,
                    height: deviceDetails.viewport.height,
                    deviceScaleFactor: deviceDetails.viewport.deviceScaleFactor,
                    isLandscape: deviceDetails.viewport.isLandscape,
                    hasTouch: deviceDetails.viewport.hasTouch,
                },
                userAgent: deviceDetails.userAgent,
            })
            await watchDog
        } else {
            const viewport = options.viewPortSize || {
                width: 1366,
                height: 768,
            }
            const watchDog = this.page.waitForFunction(
                `window.innerWidth - 10 <= ${viewport.width}`
            )
            await this.page.setViewport(viewport)
            await watchDog
        }

        let pageError: Error | undefined
        this.page.on('error', err => {
            console.error('Page had error', err)
            pageError = err
        })
        // Setup what the web server will return
        this.renderResult = render({
            html,
            css
        })

        const testServerAddress = process.env.TEST_SERVER_ADDRESS || this.getIp() || 'localhost'
        const testUrl = `http://${testServerAddress}:${this.port}`
        console.log(`Navigating to ${testUrl}`)

        let image: Buffer | undefined
        try {
            image = await this.page
                .goto(testUrl, { timeout: 45000, waitUntil: 'networkidle0' })
                .then(async () => await this.page.evaluateHandle('document.fonts.ready'))
                .then(() => {
                    if (options.preScreenshotHook) {
                        return options.preScreenshotHook(this.page)
                    }

                    return
                })
                .then(() =>
                    this.screenshotDOMElement('#app', {
                        padding: 0,
                        growContainer: options.growContainer,
                    })
                )
        } catch (err) {
            if (err.message.includes('VR Test viewport is too small')) {
                throw err
            }
            console.log('Failed to take snapshot', err)
            throw new Error(`Failed to take snapshot: ${err}`)
        }

        console.log('Verifying image')
        // Jest doesn't support async matchers yet..

        const matchImageSnapshotOpts: MatchImageSnapshotOptions = {
            misMatchPercentage: options.tolerancePercent || 0,
        }

        await toMatchImageSnapshot(
            image,
            matchImageSnapshotOpts,
            async (snapshotName, snapshotPath) => {
                if (process.env.OUTPUT_RENDER && snapshotName) {
                    const renderFile = path.join(snapshotPath, `${snapshotName}-render.html`)
                    await new Promise((resolve, reject) => {
                        fs.writeFile(renderFile, this.renderResult, err => {
                            if (err) {
                                return reject(err)
                            }
                            return resolve()
                        })
                    })
                    console.log('Output rendered output to ', renderFile)
                }
            }
        )
        if (pageError) {
            throw pageError
        }
        return {}
    }

    async start() {
        await super.start()

        try {
            this.port = await getPort()
        } catch (err) {
            throw new Error(`Failed to get port: ${err}`)
        }

        console.log(`Starting test http server on ${this.port}`)
        this.httpServer.listen(this.port)
    }

    async dispose() {
        await super.dispose()

        if (this.httpServer) {
            this.httpServer.stop()
        }
    }
}

export const vrFixture = (testFunction: (fixture: VRTestFixture) => Promise<any>) => async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000

    if (typeof document !== 'undefined') {
        throw new Error(
            'Ensure jest environment is node at the top of the file e.g /* @jest-environment node */'
        )
    }

    // TODO replace render function with your CSS in JS render function
    const fixture = new VRTestFixtureInternal(consoleLogger(), element => ({html: ReactDOM.render(element), css: ''}))

    try {
        await fixture.start()
        await testFunction(fixture)
    } finally {
        await fixture.dispose()
    }
}
