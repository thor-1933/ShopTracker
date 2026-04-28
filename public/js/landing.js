// static/js/landing.js

// Initialize AOS animations
AOS.init({
    duration: 800,
    once: true,
    offset: 100
});

// Navbar scroll effect
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(255, 255, 255, 0.95)';
        navbar.style.boxShadow = 'var(--shadow-md)';
    } else {
        navbar.style.background = 'rgba(255, 255, 255, 0.8)';
        navbar.style.boxShadow = 'none';
    }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Counter animation for stats
function animateCounter(element, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        element.innerText = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// Trigger counters when in view - FIXED: Skips elements with 'no-counter' class
const observerOptions = {
    threshold: 0.5
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // Skip elements with 'no-counter' class
            const counters = entry.target.querySelectorAll('.stat-number, .usp-stat-value:not(.no-counter)');
            counters.forEach(counter => {
                const value = counter.innerText;
                const numValue = parseInt(value.replace(/[^0-9]/g, ''));
                if (!isNaN(numValue)) {
                    animateCounter(counter, 0, numValue, 2000);
                }
            });
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Observe stats sections
document.querySelectorAll('.hero-stats, .usp-stats').forEach(section => {
    observer.observe(section);
});

// Play demo video
document.querySelector('.play-button')?.addEventListener('click', () => {
    // In real implementation, this would open a video modal
    alert('Demo video would play here - showing ShopTrack in action!');
});

// Pricing toggle animation
document.querySelectorAll('.pricing-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-5px)';
    });
    
    card.addEventListener('mouseleave', () => {
        if (!card.classList.contains('popular')) {
            card.style.transform = 'translateY(0)';
        } else {
            card.style.transform = 'scale(1.05)';
        }
    });
});
