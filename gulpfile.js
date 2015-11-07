const gulp = require('gulp');
const del = require('del');
const babel = require('gulp-babel');
const eslint = require('gulp-eslint');
const jscs = require('gulp-jscs');
const runSequence = require('run-sequence');

gulp.task('eslint', () =>
  gulp.src(['gulpfile.js', 'src/*.js'])
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failOnError()));

gulp.task('jscs', () =>
  gulp.src(['gulpfile.js', 'src/*.js'])
    .pipe(jscs({ esnext: true })));

gulp.task('clean', cb => del(['lib'], { dot: true }, cb));

gulp.task('babel', () =>
  gulp.src('src/*.js')
    .pipe(babel())
    .pipe(gulp.dest('lib')));

gulp.task('watch', () => {
  gulp.watch(['gulpfile.js', 'src/*.js'], ['jscs', 'eslint']);
});

gulp.task('test', ['eslint', 'jscs']);

gulp.task('default', ['clean'], cb =>
  runSequence(['eslint', 'jscs'], 'babel', cb));
