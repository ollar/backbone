import resolve from 'rollup-plugin-node-resolve';

export default {
  input: 'src/index.js',
  output: {
    format: 'iife',
    name: 'Backbone',
    file: 'backbone2.js',
    sourcemap: true,
  },
  plugins: [
    resolve({
      jsnext: true,
    }),
  ],
};
