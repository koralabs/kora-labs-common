const path = require('node:path');

module.exports = {
    ...require('../jest.config.json'),
    rootDir: path.resolve(__dirname, '..'),
    // Include untouched source in the denominator, not only modules imported by tests.
    collectCoverageFrom: ['src/**/*.{ts,tsx,js}', '!src/**/*.test.ts', '!src/**/*.d.ts'],
    coverageReporters: ['text', 'json-summary']
};
