# Visual Regression Testing

The code has been extracted from our project, we haven't set up the build process in this repository yet, but it should be in working order if you want to get started on your own. 

## Usage

Note: In the index.tsx at the VRFixture, you'll need to replace the render function with your CSS in JS render function.

``` ts
it(
    'test name',
    // vrFixture sets everything up and passes you a fixture
    vrFixture(async fixture => {
        // fixture exposes takeSnapshot(reactElement, options)
        await fixture.takeSnapshot(
            wrapInRouter(<BreakingNews text="Example words" link="/example-link" />, thewest),
            {
                viewPortSize: 'iPad'
            }
        )
    })
)
```

## Options
### viewPortSize?: puppeteer.ViewPort | PuppeteerDevice
A puppeteer viewport contains width, height, pixel density and other viewport related things

You can also pass a device which will emulate the viewport of that device

### growContainer?: { height?: number, width?: number }
Useful when the component floats outside the container and you need to grow the snapshot container

### padding?: { left: number; right: number }
Adds padding around a component, useful for detecting issues where container breakpoints would be handy but we only have viewport breakpoints

### preScreenshotHook?: (page: puppeteer.Page) => Promise<any>
Gives you access to the page before the screenshot is taken, this is useful to force hover/focus states etc