# rx-slackbot

slackbot using rxjs

import del from 'del';
import gulp from 'gulp';
import babel from 'gulp-babel';
import eslint from 'gulp-eslint';
import jscs from 'gulp-jscs';
import runSequence from 'run-sequence';

gulp.task('eslint', () =>
  gulp.src(['gulpfile.babel.js', 'src/*.js'])
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failOnError()));

gulp.task('jscs', () =>
  gulp.src(['gulpfile.babel.js', 'src/*.js'])
    .pipe(jscs({ esnext: true })));

gulp.task('clean', cb => del(['lib'], { dot: true }, cb));

gulp.task('babel', () =>
  gulp.src('src/*.js')
    .pipe(babel())
    .pipe(gulp.dest('lib')));

gulp.task('watch', () => {
  gulp.watch(['gulpfile.babel.js', 'src/*.js'], ['jscs', 'eslint']);
});

gulp.task('test', ['eslint', 'jscs']);

gulp.task('default', ['clean'], cb =>
  runSequence(['eslint', 'jscs'], 'babel', cb));
