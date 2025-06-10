const axios = require('axios');

async function geocodeAddress(address) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1
      }
    });

    if (response.data.length > 0) {
      return {
        latitude: parseFloat(response.data[0].lat),
        longitude: parseFloat(response.data[0].lon)
      };
    }

    return null;
  } catch (error) {
    console.error('Ошибка геокодирования:', error);
    return null;
  }
}
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Средний радиус Земли в километрах

  // Преобразуем градусы в радианы
  const radLat1 = degToRad(lat1);
  const radLng1 = degToRad(lng1);
  const radLat2 = degToRad(lat2);
  const radLng2 = degToRad(lng2);

  // Разница координат
  const deltaLat = radLat2 - radLat1;
  const deltaLng = radLng2 - radLng1;

  // Формула Haversine
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radLat1) *
    Math.cos(radLat2) *
    Math.sin(deltaLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Возвращаем расстояние в километрах
}

// Вспомогательная функция для перевода градусов в радианы
function degToRad(degrees) {
  return degrees * (Math.PI / 180);
}

// Функция для геокодирования адресов
async function geocodeAddress(address) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1
      }
    });

    if (response.data.length > 0) {
      return {
        latitude: parseFloat(response.data[0].lat),
        longitude: parseFloat(response.data[0].lon)
      };
    }

    return null;
  } catch (error) {
    console.error('Ошибка геокодирования:', error);
    return null;
  }
}

