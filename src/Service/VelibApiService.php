<?php

namespace App\Service;

use DateTimeImmutable;
use Psr\Cache\CacheItemPoolInterface;
use Symfony\Component\DependencyInjection\Attribute\Target;
use Symfony\Contracts\HttpClient\Exception\ServerExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class VelibApiService
{
    private const CACHE_KEY = 'latest_complete_stations';
    private const FRESHNESS_SECONDS = 60;
    private const MAX_STALE_SECONDS = 86400;

    private const STATUS_URL =
        'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_status.json';

    private const INFO_URL =
        'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json';


    public function __construct(
        private HttpClientInterface $httpClient,
        #[Target('cache.velib_stations')]
        private CacheItemPoolInterface $stationsCache,
    ) {
    }

    private function getRentalStatus(int $bikes): string
    {
        if ($bikes === 0) {
            return 'Indisponible';
        }

        if ($bikes <= 3) {
            return 'Quelques vélos';
        }

        return 'Disponible';
    }

    private function getReturnStatus(int $docks): string
    {
        if ($docks === 0) {
            return 'Impossible';
        }

        if ($docks <= 5) {
            return 'Peu de places';
        }

        return 'Places disponibles';
    }

    public function getStations(): array
    {
        return $this->getStationsWithMetadata()['stations'];
    }

    /**
     * @return array{
     *     stations: list<array<string, mixed>>,
     *     fetchedAt: string,
     *     stale: bool
     * }
     */
    public function getStationsWithMetadata(): array
    {
        $cachedData = $this->readCachedStations();
        $now = time();

        if (
            null !== $cachedData
            && $now >= $cachedData['fetchedAt']
            && $now - $cachedData['fetchedAt'] < self::FRESHNESS_SECONDS
        ) {
            return $this->createStationsSnapshot($cachedData, false);
        }

        try {
            $stations = $this->fetchCompleteStations();
        } catch (TransportExceptionInterface|ServerExceptionInterface $exception) {
            $fallbackAge = null === $cachedData
                ? null
                : time() - $cachedData['fetchedAt'];

            if (
                null !== $fallbackAge
                && $fallbackAge >= 0
                && $fallbackAge < self::MAX_STALE_SECONDS
            ) {
                return $this->createStationsSnapshot($cachedData, true);
            }

            throw $exception;
        }

        $fetchedAt = time();
        $cachedData = [
            'stations' => $stations,
            'fetchedAt' => $fetchedAt,
        ];
        $this->saveCachedStations($stations, $fetchedAt);

        return $this->createStationsSnapshot($cachedData, false);
    }

    /**
     * @param array{stations: list<array<string, mixed>>, fetchedAt: int} $cachedData
     * @return array{stations: list<array<string, mixed>>, fetchedAt: string, stale: bool}
     */
    private function createStationsSnapshot(array $cachedData, bool $stale): array
    {
        return [
            'stations' => $cachedData['stations'],
            'fetchedAt' => (new DateTimeImmutable('@'.$cachedData['fetchedAt']))
                ->format(DATE_ATOM),
            'stale' => $stale,
        ];
    }

    /**
     * @return array{stations: list<array<string, mixed>>, fetchedAt: int}|null
     */
    private function readCachedStations(): ?array
    {
        $item = $this->stationsCache->getItem(self::CACHE_KEY);

        if (!$item->isHit()) {
            return null;
        }

        $data = $item->get();

        if (
            !is_array($data)
            || !isset($data['stations'], $data['fetchedAt'])
            || !is_array($data['stations'])
            || !is_int($data['fetchedAt'])
        ) {
            return null;
        }

        return $data;
    }

    /**
     * @param list<array<string, mixed>> $stations
     */
    private function saveCachedStations(array $stations, int $fetchedAt): void
    {
        $item = $this->stationsCache->getItem(self::CACHE_KEY);
        $item->set([
            'stations' => $stations,
            'fetchedAt' => $fetchedAt,
        ]);
        $item->expiresAfter(self::MAX_STALE_SECONDS);
        $this->stationsCache->save($item);
    }

    /**
     * Fetches and combines both API feeds before returning a cacheable result.
     *
     * @return list<array<string, mixed>>
     */
    private function fetchCompleteStations(): array
    {
        $status = $this->httpClient
            ->request('GET', self::STATUS_URL)
            ->toArray();


        $information = $this->httpClient
            ->request('GET', self::INFO_URL)
            ->toArray();

        $statusStations = $status['data']['stations'] ?? null;
        $informationStations = $information['data']['stations'] ?? null;

        if (
            !is_array($statusStations)
            || [] === $statusStations
            || !is_array($informationStations)
            || [] === $informationStations
        ) {
            throw new \UnexpectedValueException(
                'Incomplete Vélib API response: station feeds are missing or empty.',
            );
        }

        $stationsInfo = [];

        foreach ($informationStations as $station) {
            if (!is_array($station) || !isset($station['station_id'])) {
                throw new \UnexpectedValueException(
                    'Incomplete Vélib API response: station information is invalid.',
                );
            }

            $stationsInfo[$station['station_id']] = $station;
        }


        $stations = [];

        

        foreach ($statusStations as $station) {
            if (
                !is_array($station)
                || !isset(
                    $station['station_id'],
                    $station['num_bikes_available'],
                    $station['num_bikes_available_types'],
                    $station['num_docks_available'],
                )
                || !is_array($station['num_bikes_available_types'])
                || !is_numeric($station['num_bikes_available'])
                || !is_numeric($station['num_docks_available'])
            ) {
                throw new \UnexpectedValueException(
                    'Incomplete Vélib API response: station status is invalid.',
                );
            }

            $mechanicalBikes = 0;
            $electricBikes = 0;

            foreach ($station['num_bikes_available_types'] as $type) {

                if (isset($type['mechanical'])) {
                    $mechanicalBikes = $type['mechanical'];
                }

                if (isset($type['ebike'])) {
                    $electricBikes = $type['ebike'];
                }
            }

            $id = $station['station_id'];


            $stations[] = [
                'id' => $station['station_id'],
                'name' => $stationsInfo[$id]['name'] ?? 'Station inconnue',
                'address' => $stationsInfo[$id]['address'] ?? '',
                'latitude' => $stationsInfo[$id]['lat'] ?? null,
                'longitude' => $stationsInfo[$id]['lon'] ?? null,
                'capacity' => $stationsInfo[$id]['capacity'] ?? 0,
                'bikes' => $station['num_bikes_available'],
                'mechanicalBikes' => $mechanicalBikes,
                'electricBikes' => $electricBikes,
                'docks' => $station['num_docks_available'],
                'rentalStatus' => $this->getRentalStatus(
                    $station['num_bikes_available']
                ),
                'returnStatus' => $this->getReturnStatus(
                    $station['num_docks_available']
                ),
            ];

            
        }
        

        return $stations;
    }
}


