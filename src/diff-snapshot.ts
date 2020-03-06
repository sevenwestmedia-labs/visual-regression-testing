import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import resemble from 'resemblejs'
import Canvas, { createCanvas } from 'canvas'
import { PromiseCompletionSource } from 'promise-completion-source'

export interface Options {
    imageData: Buffer
    snapshotIdentifier: string
    snapshotsDir: string
    updateSnapshot: boolean
    tolerancePercent: number
}

export interface DiffDetails {
    /**
     * Do the two images have the same dimensions?
     */
    isSameDimensions: boolean

    /**
     * The difference in width and height between the dimensions of the two compared images
     */
    dimensionDifference: {
        width: number
        height: number
    }

    /**
     * The percentage of pixels which do not match between the images
     */
    misMatchPercentage: number

    diffBounds: {
        top: number
        left: number
        bottom: number
        right: number
    }

    analysisTime: number

    diffOutputPath: string
    baselineSnapshotPath: string
}
export interface Diff {
    details: DiffDetails
    image: Buffer
}
export interface DiffResult {
    result?: Diff
    added: boolean
    updated: boolean
}

export async function diffImageToSnapshot(options: Options): Promise<DiffResult> {
    const { imageData, snapshotIdentifier, snapshotsDir, updateSnapshot = false } = options

    const baselineSnapshotPath = path.join(snapshotsDir, `${snapshotIdentifier}-snap.png`)
    const outputDir = path.join(snapshotsDir, '__diff_output__')
    const diffOutputPath = path.join(outputDir, `${snapshotIdentifier}-diff.png`)
    mkdirp.sync(outputDir)

    const diffDetails = fs.existsSync(baselineSnapshotPath)
        ? await new Promise<Diff>(resolve => {
              type Result = resemble.ResembleComparisonResult & { getBuffer(): Buffer } & {
                  specifiedTolerance?: number
              }
              const comparer = resemble(baselineSnapshotPath)
                  // Not in the types, the global outputSettings function warns now
              ;(comparer as any).outputSettings({
                  errorColor: {
                      red: 255,
                      green: 0,
                      blue: 255,
                  },
                  errorType: 'movement',
                  largeImageThreshold: 600,
              })
              const comparison = comparer.compareTo(imageData as any)

              comparison.onComplete(diffResult => {
                  if ('error' in diffResult) {
                      console.log(
                          `ResembleJS failed to create a diff result, which usually means it cannot find node-gyp, or can't open the comparison file`
                      )
                      throw new Error()
                  }
                  const diffBuffer = (diffResult as Result).getBuffer()

                  if (options.tolerancePercent !== 0) {
                      ;(diffResult as Result).specifiedTolerance = options.tolerancePercent
                  }

                  console.log('Diffing complete', diffResult)

                  resolve({
                      details: {
                          analysisTime: diffResult.analysisTime,
                          diffBounds: diffResult.diffBounds,
                          dimensionDifference: diffResult.dimensionDifference,
                          isSameDimensions: diffResult.isSameDimensions,
                          misMatchPercentage: diffResult.misMatchPercentage,
                          diffOutputPath,
                          baselineSnapshotPath,
                      },
                      image: diffBuffer,
                  })
              })
          })
        : undefined

    if (diffDetails && !updateSnapshot) {
        // The below creates a stiched image which is the baseline, the new,
        // then the diff in a single image
        const baselineBuffer = await new Promise<Buffer>((resolve, reject) => {
            fs.readFile(baselineSnapshotPath, (err, data) => {
                if (err) {
                    return reject(err)
                }

                resolve(data)
            })
        })

        const stitchingDone = new PromiseCompletionSource()
        // The below windiness is due to using the workaround described in
        // https://github.com/Automattic/node-canvas/issues/785#issuecomment-241311742
        // to stop memory leaks
        const baselineImage = new Canvas.Image()
        const diffImage = new Canvas.Image()
        const newImage = new Canvas.Image()
        const createStitchedImage = () => {
            const maxWidth = Math.max(baselineImage.width, diffImage.width, newImage.width)

            // When width is larger than height, we should stack the images vertically
            if (
                maxWidth > baselineImage.height &&
                maxWidth > diffImage.height &&
                maxWidth > newImage.height
            ) {
                const stitchedImage = createCanvas(
                    Math.max(baselineImage.width, diffImage.width, newImage.width),
                    baselineImage.height + diffImage.height + newImage.height
                )
                const ctx = stitchedImage.getContext('2d')
                ctx.drawImage(baselineImage as any, 0, 0)
                ctx.drawImage(newImage as any, 0, baselineImage.height)
                ctx.drawImage(diffImage as any, 0, baselineImage.height + newImage.height)
                diffDetails.image = stitchedImage.toBuffer()
            } else {
                // Otherwise horizontally
                const stitchedImage = createCanvas(
                    baselineImage.width + diffImage.width + newImage.width,
                    Math.max(baselineImage.height, diffImage.height, newImage.height)
                )
                const ctx = stitchedImage.getContext('2d')
                ctx.drawImage(baselineImage as any, 0, 0)
                ctx.drawImage(newImage as any, baselineImage.width, 0)
                ctx.drawImage(diffImage as any, baselineImage.width + newImage.width, 0)
                diffDetails.image = stitchedImage.toBuffer()
            }

            baselineImage.src = null as any
            newImage.src = null as any
            diffImage.src = null as any
            stitchingDone.resolve({})
        }

        const stitchingPromise = stitchingDone.promise
        baselineImage.onload = () => {
            diffImage.onload = () => {
                newImage.onload = createStitchedImage
                newImage.src = imageData
            }
            diffImage.src = diffDetails.image
        }
        baselineImage.src = baselineBuffer
        await stitchingPromise

        return {
            added: false,
            updated: false,
            result: diffDetails,
        }
    }

    const withinTolerance =
        diffDetails && diffDetails.details.misMatchPercentage <= options.tolerancePercent
    if (updateSnapshot && withinTolerance) {
        return { updated: true, added: false }
    }

    mkdirp.sync(snapshotsDir)
    fs.writeFileSync(baselineSnapshotPath, imageData)
    if (updateSnapshot) {
        return { updated: true, added: false }
    }
    return { added: true, updated: false }
}
