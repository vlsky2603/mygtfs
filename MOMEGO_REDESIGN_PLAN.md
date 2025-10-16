# План переделки дизайна в стиле Momego/Moovit

## ✅ Сделано

### 1. Сохранение старой версии
- ✅ Создан коммит: `68a2e6d` - "Save current design before Moovit/Momego redesign"
- ✅ Созданы ветки:
  - `classic-design` - классический дизайн
  - `momego-redesign` - новый дизайн Moovit
- ✅ Резервные копии файлов:
  - `public/styles.classic.css`
  - `public/index.classic.html`
- ✅ Документация: `DESIGN_SWITCH.md`

### 2. Новый CSS файл
- ✅ Создан `public/styles.momego.css` с:
  - Цветовая схема Moovit (голубой #00aff0)
  - Современные карточки и панели
  - Яркие маркеры остановок (пины)
  - Bottom sheets для панелей
  - Адаптивный дизайн

## 🔄 В процессе

### 3. Основные компоненты для переделки

#### A. HTML структура (`public/index.html`)
- [ ] Добавить поисковую строку в стиле Moovit
- [ ] Переделать нижнюю панель управления
- [ ] Обновить структуру панелей (bottom sheets)
- [ ] Добавить иконки для кнопок

#### B. JavaScript адаптация
- [ ] `public/main_dynamic.js` - обновить классы и селекторы
- [ ] `public/js/map_drawer.js` - применить новые стили маркеров
- [ ] `public/js/ui_controller.js` - адаптировать под новые панели
- [ ] `public/js/schedule_enhancer.js` - новый дизайн карточек маршрутов

#### C. Дополнительные стили
- [ ] Анимации переходов между панелями
- [ ] Эффекты нажатий (ripple effect)
- [ ] Улучшенные скроллы
- [ ] Градиенты для карточек

### 4. Новые фичи в стиле Moovit

- [ ] **Поисковая строка сверху**
  - Фиксированная позиция
  - Автокомплит остановок
  - Иконка лупы

- [ ] **Bottom Navigation Bar**
  - Главная (Home)
  - Маршруты (Routes)
  - Избранное (Favorites)
  - Настройки (Settings)

- [ ] **Карточки маршрутов**
  - Номер маршрута в круге
  - Название и направление
  - Время прибытия крупным шрифтом
  - Индикатор загруженности

- [ ] **Bottom Sheets для панелей**
  - Расписание остановки
  - Детали маршрута
  - Список избранного
  - Настройки

- [ ] **Улучшенная симуляция**
  - Более крупные маркеры автобусов
  - Анимация движения
  - Trail (след) за автобусом

## 📝 Детальный план действий

### Этап 1: Базовая структура HTML
```html
<!-- Новая структура -->
<div class="momego-app">
    <!-- Поисковая строка -->
    <div class="momego-search-bar">
        <span class="momego-search-icon">🔍</span>
        <input type="text" placeholder="Поиск остановок или маршрутов...">
    </div>
    
    <!-- Карта -->
    <div id="map"></div>
    
    <!-- Нижняя навигация -->
    <nav id="header-controls">
        <button class="control-button active">
            <span>🏠</span>
            <span>Главная</span>
        </button>
        <button class="control-button">
            <span>🚌</span>
            <span>Маршруты</span>
        </button>
        <button class="control-button">
            <span>⭐</span>
            <span>Избранное</span>
        </button>
        <button class="control-button">
            <span>⚙️</span>
            <span>Настройки</span>
        </button>
    </nav>
    
    <!-- Панели (Bottom Sheets) -->
    <div id="schedule-panel" class="momego-panel">
        <div class="momego-panel-handle"></div>
        <div class="momego-panel-header">
            <h2 class="momego-panel-title">Расписание</h2>
            <button class="momego-panel-close">✕</button>
        </div>
        <div class="momego-panel-content">
            <!-- Контент панели -->
        </div>
    </div>
</div>
```

### Этап 2: Обновление маркеров
- ✅ Остановки - уже реализовано (пины в форме капли)
- [ ] Автобусы - квадратные карточки с номером
- [ ] Пользователь - яркая голубая точка

### Этап 3: Карточки маршрутов
```html
<div class="route-card">
    <div class="route-badge">16</div>
    <div class="route-info">
        <div class="route-name">Downtown</div>
        <div class="route-description">via Main St</div>
    </div>
    <div class="route-time">
        <div class="route-arrival">4 min</div>
        <div class="route-minutes">🟢 Low</div>
    </div>
</div>
```

### Этап 4: Анимации и переходы
- [ ] Плавное открытие панелей снизу
- [ ] Ripple эффект при нажатии
- [ ] Fade анимации для элементов списка
- [ ] Скольжение карточек

### Этап 5: Темная тема
- ✅ Переменные CSS уже настроены
- [ ] Кнопка переключения
- [ ] Сохранение предпочтений в localStorage

## 🎨 Цветовая палитра Moovit

### Светлая тема
- Основной: `#00aff0` (голубой)
- Фон: `#f2f2f7`
- Карточки: `#ffffff`
- Текст: `#1c1c1e`
- Серый текст: `#8e8e93`

### Тёмная тема
- Основной: `#32d1ff` (светло-голубой)
- Фон: `#000000`
- Карточки: `#2c2c2e`
- Текст: `#ffffff`
- Серый текст: `#98989d`

## 📱 Приоритеты

1. **Высокий приоритет**
   - Поисковая строка
   - Bottom navigation
   - Карточки маршрутов
   - Bottom sheets панели

2. **Средний приоритет**
   - Анимации
   - Темная тема
   - Иконки

3. **Низкий приоритет**
   - Ripple эффекты
   - Дополнительные микроанимации
   - Кастомные скроллбары

## 🚀 Следующий шаг

Начать с обновления `public/index.html` - добавить:
1. Поисковую строку сверху
2. Обновить структуру нижней панели
3. Переделать панели в bottom sheets
