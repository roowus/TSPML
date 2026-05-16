import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/loader/TS_PML_LOADER.ts',
  output: {
    file: 'dist/TS_PML_LOADER.js',
    format: 'iife',
    name: 'TS_PML_LOADER'
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      sourceMap: false
    })
  ]
};
