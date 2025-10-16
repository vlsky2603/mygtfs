# Переключение между дизайнами

## Доступные дизайны

### 1. Classic Design (Классический)
- Оригинальный дизайн приложения
- Сохранён в ветке: `classic-design`
- Файлы: `public/styles.classic.css`, `public/index.classic.html`

### 2. Momego/Moovit Design (Современный)
- Новый дизайн в стиле Moovit/Momego
- Ветка: `momego-redesign`
- Файлы: `public/styles.css`, `public/index.html`

## Как переключиться между дизайнами

### Вариант 1: Через Git ветки

```bash
# Переключиться на классический дизайн
git checkout classic-design

# Переключиться на Momego дизайн
git checkout momego-redesign
```

### Вариант 2: Копирование файлов (без Git)

```bash
# Вернуться к классическому дизайну
cd /workspaces/mygtfs/public
cp styles.classic.css styles.css
cp index.classic.html index.html

# Вернуться к Momego дизайну
# (после сохранения новых файлов как styles.momego.css и index.momego.html)
cp styles.momego.css styles.css
cp index.momego.html index.html
```

## Текущий коммит

- Classic design сохранён в коммите: `68a2e6d`
- Сообщение: "Save current design before Moovit/Momego redesign"

## Что изменится в Momego дизайне

### Цветовая схема
- Яркие, контрастные цвета
- Современные градиенты
- Улучшенная читаемость

### Маркеры остановок
- ✅ Уже реализовано: Пины в стиле Moovit
- Форма капли с тенью
- Яркие цвета (синий для обычных, золотой для избранных)

### Интерфейс
- Более крупные элементы управления
- Современные карточки с тенями
- Улучшенная анимация
- Более чёткая типографика

### Автобусные маркеры
- Более крупные и заметные
- Анимированные эффекты движения
- Индикаторы загруженности (уже реализовано)

### Панели и меню
- Современный Material Design
- Плавные переходы
- Улучшенная иерархия информации
