const gulp = require('gulp');
const babel = require('gulp-babel');
const sourcemaps = require('gulp-sourcemaps');
const xo = require('gulp-xo');
const plumber = require('gulp-plumber');
const del = require('del');

gulp.task('default', gulp.series(
  () => del(['lib'], { dot: true }),
  () =>
    gulp.src('src/**/*.js')
      .pipe(sourcemaps.init())
      .pipe(babel({
        plugins: [
          'transform-function-bind',
          'transform-es2015-modules-commonjs',
          'transform-es2015-destructuring',
          'transform-es2015-parameters'
        ]
      }))
      .pipe(sourcemaps.write())
      .pipe(gulp.dest('lib'))));

const lint = () =>
  gulp.src(['src/**/*.js', 'gulpfile.js'])
    .pipe(plumber())
    .pipe(xo());

gulp.task('test', () => gulp.src(['src/**/*.js', 'gulpfile.js']).pipe(xo()));

gulp.task('watch', gulp.series(lint, () => {
  gulp.watch(['src/**/*.js', 'gulpfile.js'], lint);
}));
