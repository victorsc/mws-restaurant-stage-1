const gulp = require('gulp');
const runSequence = require('run-sequence');
const del = require('del');
const cleanCSS = require('gulp-clean-css');
const concat = require('gulp-concat');
const sourcemaps = require('gulp-sourcemaps');
const babel = require('gulp-babel');
const uglify = require('gulp-uglify');
const imagemin = require('gulp-imagemin');
const jpegtran = require('imagemin-jpegtran');
const responsive = require('gulp-responsive');
const JS_FOLDER = 'static/js/';
const jsFiles = [
    JS_FOLDER + 'swloader.js',
    // JS_FOLDER + 'toastr.min.js',
    JS_FOLDER + 'lazy_loading.js',
    JS_FOLDER + 'idb.js',
    JS_FOLDER + 'indexeddb.js',
    JS_FOLDER + 'dbhelper.js'
];

const swFiles = [
    JS_FOLDER + 'idb.js',
    JS_FOLDER + 'indexeddb.js',
    'static/sw.js'
];

gulp.task('clean', () => {
    return del.sync('public');
});

gulp.task('copy-static', () => {
    gulp.src(['static/*', '!static/sw.js'])
        .pipe(gulp.dest('public'));
});

gulp.task('css-minify', () => {
    return gulp.src('static/css/*.css')
        .pipe(cleanCSS())
        .pipe(concat('styles.css'))
        .pipe(gulp.dest('public/css'));
});

gulp.task('scripts', () => {
    return gulp.src(jsFiles.concat(JS_FOLDER + 'main.js'))
        .pipe(sourcemaps.init())
        .pipe(babel())
        .pipe(concat('main.min.js'))
        .pipe(uglify())
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('public/js'));
});

gulp.task('restaurant-script', () => {
    return gulp.src(jsFiles.concat(JS_FOLDER + 'restaurant_info.js'))
        .pipe(sourcemaps.init())
        .pipe(babel())
        .pipe(concat('restaurant.min.js'))
        .pipe(uglify())
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('public/js'));
});

gulp.task('sw-script', () => {
    return gulp.src(swFiles)
        .pipe(sourcemaps.init())
        .pipe(babel())
        .pipe(concat('sw.js'))
        // .pipe(uglify())
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('public'));
});

gulp.task('images', () => {
    gulp.src('static/img/**/*')
        .pipe(imagemin({
            progressive: true,
            use: [jpegtran()]
        }))
        .pipe(responsive({
            '*.jpg': [{
              width: 300,
              rename: { suffix: '_300' },
            }, {
              width: 800,
              rename: { suffix: '_800' }
            }],
          }, {
            quality: 70,
            progressive: true,
            errorOnUnusedImage: false
          }))
        .pipe(gulp.dest('public/img'));
});

gulp.task('build', cb => {
    runSequence(
        'clean',
        'css-minify',
        'scripts',
        'restaurant-script',
        'copy-static',
        'sw-script',
        'images',
        cb);
});

gulp.task('watch', () => {
    gulp.watch('static/*.html', ['copy-static']);
    gulp.watch('static/css/**/*.css', ['css-minify']);
    gulp.watch('static/js/**/*.js', ['scripts', 'restaurant-script']);
    gulp.watch('static/sw.js', ['copy-static']);
  });