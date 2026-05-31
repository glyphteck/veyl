import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

const files = ["**/*.{js,jsx,mjs,cjs}"];
const web = ["apps/web/**/*.{js,jsx,mjs}"];
const ios = ["apps/ios/**/*.{js,jsx,mjs}"];
const shared = ["shared/**/*.{js,jsx,mjs}"];
const node = [
    "apps/bot/**/*.{js,mjs,cjs}",
    "functions/**/*.{js,mjs,cjs}",
    "scripts/**/*.{js,mjs,cjs}",
    "*.config.{js,mjs,cjs}",
    "eslint.config.mjs"
];
const appImportPaths = ["apps/*", "../apps/*", "../../apps/*", "../../../apps/*"];
const functionsImportPaths = ["functions/*", "../functions/*", "../../functions/*", "../../../functions/*"];
const scriptsImportPaths = ["scripts/*", "../scripts/*", "../../scripts/*", "../../../scripts/*"];
const webImportPaths = ["apps/web/*", "../web/*", "../../web/*", "../../../web/*"];
const iosImportPaths = ["apps/ios/*", "../ios/*", "../../ios/*", "../../../ios/*"];

export default [
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error"
        }
    },
    {
        ignores: [
            "**/node_modules/**",
            "**/.next/**",
            "**/.expo/**",
            "**/dist/**",
            "**/coverage/**",
            "apps/ios/ios/**"
        ]
    },
    js.configs.recommended,
    {
        files,
        plugins: {
            "react-hooks": hooks
        },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: {
                ecmaFeatures: {
                    jsx: true
                }
            },
            globals: {
                ...globals.es2024,
                ...globals.browser,
                ...globals.node
            }
        },
        rules: {
            "no-undef": "error",
            "no-control-regex": "off",
            "no-unused-vars": "off",
            "no-useless-assignment": "error",
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "no-restricted-globals": [
                "error",
                { name: "alert", message: "Use app UI instead of alert()." },
                { name: "confirm", message: "Use a dialog instead of confirm()." },
                { name: "prompt", message: "Use app UI instead of prompt()." }
            ],
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "off"
        }
    },
    {
        files: shared,
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [...appImportPaths, ...functionsImportPaths, ...scriptsImportPaths],
                            message: "Shared code must not depend on app, functions, or script files."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: web,
        languageOptions: {
            globals: {
                ...globals.browser
            }
        },
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: iosImportPaths,
                            message: "Web code must not import from the iOS app."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: ios,
        languageOptions: {
            globals: {
                ...globals.browser,
                __DEV__: "readonly",
                cancelAnimationFrame: "readonly",
                requestAnimationFrame: "readonly",
                setImmediate: "readonly"
            }
        },
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: webImportPaths,
                            message: "iOS code must not import from the web app."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: ["functions/**/*.{js,mjs,cjs}"],
        languageOptions: {
            globals: {
                ...globals.node
            }
        },
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: appImportPaths,
                            message: "Functions must not import client app files."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: node,
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },
    {
        files: ["**/*.cjs"],
        languageOptions: {
            sourceType: "commonjs"
        }
    }
];
