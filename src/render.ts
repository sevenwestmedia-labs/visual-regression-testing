// Note: Globally disabling animations will break some vr tests
export const render = (renderResult: { html: string; css: string }) => {
    return `<html>
    <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/7.0.0/normalize.min.css" />
        <style>
            *,
            *::before,
            *::after {
                box-sizing: border-box;
                transition: none !important;
                animation-duration: 0ms !important;
                animation-fill-mode: both !important;
            }
        </style>
        <style>${renderResult.css}</style>
        </head>
        <body>
            <div id='app'><div id='wrapper'>${renderResult.html}</div></div>
        </body>
    </html>
    `
}
