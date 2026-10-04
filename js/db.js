// Local storage data layer — everything stays on the device, nothing is sent anywhere.
const DB_KEY = 'hw_collection_v1';

function dbLoad() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('dbLoad failed', e);
    return [];
  }
}

function dbSave(cars) {
  localStorage.setItem(DB_KEY, JSON.stringify(cars));
}

function dbMakeId() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function dbUpsert(cars, car) {
  const idx = cars.findIndex((c) => c.id === car.id);
  if (idx >= 0) {
    cars[idx] = car;
  } else {
    car.id = car.id || dbMakeId();
    cars.push(car);
  }
  dbSave(cars);
  return cars;
}

function dbDelete(cars, id) {
  const next = cars.filter((c) => c.id !== id);
  dbSave(next);
  return next;
}

function dbClearAll() {
  dbSave([]);
}
