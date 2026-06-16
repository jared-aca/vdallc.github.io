/* VDA LLC — Site Scripts */

(function () {
  'use strict';

  // ---- Sticky header shadow ----
  var header = document.getElementById('site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---- Mobile menu ----
  var toggle = document.getElementById('menu-toggle');
  var mobileNav = document.getElementById('mobile-nav');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
      });
    });

    document.addEventListener('click', function (e) {
      if (!header.contains(e.target) && mobileNav.classList.contains('open')) {
        mobileNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // ---- Scroll reveal ----
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var delay = el.dataset.delay || 0;
          setTimeout(function () {
            el.classList.add('in-view');
          }, delay);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(function (el, index) {
      if (!el.dataset.delay) {
        el.dataset.delay = (index % 5) * 80;
      }
      observer.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add('in-view');
    });
  }

  // ---- Smooth active nav highlight on scroll ----
  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav-primary a[href^="#"]');

  if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
    var activeSection = null;

    var navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          activeSection = entry.target.id;
          navLinks.forEach(function (link) {
            var href = link.getAttribute('href').slice(1);
            link.classList.toggle('active', href === activeSection);
          });
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });

    sections.forEach(function (section) { navObserver.observe(section); });
  }

  // ---- Megamenu ----
  var navServices = document.getElementById('nav-services');
  var megamenu    = document.getElementById('megamenu');
  var megaTimer;

  if (navServices && megamenu) {
    function openMega() {
      clearTimeout(megaTimer);
      navServices.classList.add('is-open');
      megamenu.classList.add('is-open');
      megamenu.setAttribute('aria-hidden', 'false');
      navServices.querySelector('a').setAttribute('aria-expanded', 'true');
    }
    function closeMega(immediate) {
      if (immediate) {
        navServices.classList.remove('is-open');
        megamenu.classList.remove('is-open');
        megamenu.setAttribute('aria-hidden', 'true');
        navServices.querySelector('a').setAttribute('aria-expanded', 'false');
      } else {
        megaTimer = setTimeout(function () { closeMega(true); }, 130);
      }
    }

    navServices.addEventListener('mouseenter', openMega);
    navServices.addEventListener('mouseleave', function () { closeMega(false); });
    megamenu.addEventListener('mouseenter', function () { clearTimeout(megaTimer); });
    megamenu.addEventListener('mouseleave', function () { closeMega(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMega(true);
    });
    document.addEventListener('click', function (e) {
      if (!navServices.contains(e.target) && !megamenu.contains(e.target)) {
        closeMega(true);
      }
    });
  }

  // ---- Dark mode toggle ----
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('vda-theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('vda-theme', 'dark');
      }
    });
  }

  // ---- Contact forms — real POST via FormSubmit ----
  // No JS interception needed; forms use action="https://formsubmit.co/..."

})();
